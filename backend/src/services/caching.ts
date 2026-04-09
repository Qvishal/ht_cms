/**
 * Caching Service: Redis operations and cache management
 * Handles both admin (sessions/RBAC) and public API caching
 */

import { createClient } from "redis";
import { buildCacheKey } from "../lib/cacheKeys";

export interface CacheConfig {
  ttl: {
    query: number; // 5 minutes
    row: number; // 15 minutes
    session: number; // 24 hours
    rbac: number; // 1 hour
    stats: number; // 5 minutes
  };
  strategy: "HYBRID" | "REDIS_ONLY" | "DISABLED";
  publicOnly: boolean; // Only cache /api/public/* endpoints
}

const defaultConfig: CacheConfig = {
  ttl: {
    query: 300, // 5 minutes
    row: 900, // 15 minutes
    session: 86400, // 24 hours
    rbac: 3600, // 1 hour
    stats: 300, // 5 minutes
  },
  strategy: "HYBRID",
  publicOnly: true,
};

let redisInstance: any = null;
let redisClient: any = null;
let config = defaultConfig;

/**
 * Initialize Redis connection
 */
export async function initializeRedis(redisUrl?: string) {
  if (redisInstance) return redisInstance;

  try {
    const client = createClient({
      url: redisUrl || process.env.REDIS_URL || "redis://localhost:6379",
    });

    client.on("error", (err) => {
      console.error("Redis Client Error", err);
      config.strategy = "DISABLED";
    });

    await client.connect();

    // Store client reference for stats and admin operations
    redisClient = client;

    redisInstance = {
      get: async (key: string) => {
        try {
          const value = await client.get(key);
          if (value) {
            // Log cache hit
            await logCacheOperation({
              type: "HIT",
              key,
              table: extractTable(key),
            });
          }
          return value;
        } catch (e) {
          console.error(`Redis GET error for ${key}:`, e);
          return null;
        }
      },
      set: async (key: string, value: string, ttl?: number) => {
        try {
          if (ttl) {
            await client.setEx(key, ttl, value);
          } else {
            await client.set(key, value);
          }
        } catch (e) {
          console.error(`Redis SET error for ${key}:`, e);
        }
      },
      del: async (keys: string[]) => {
        try {
          if (keys.length > 0) {
            await client.del(keys);
          }
        } catch (e) {
          console.error(`Redis DEL error:`, e);
        }
      },
      scanDelete: async (pattern: string) => {
        try {
          let cursor = 0;
          let keysDeleted = 0;

          do {
            const result = await client.scan(cursor, {
              MATCH: pattern,
            });
            cursor = result.cursor;

            if (result.keys && result.keys.length > 0) {
              await client.del(result.keys);
              keysDeleted += result.keys.length;
            }
          } while (cursor !== 0);

          return keysDeleted;
        } catch (e) {
          console.error(`Redis SCAN error for pattern ${pattern}:`, e);
          return 0;
        }
      },
      exists: async (key: string) => {
        try {
          return await client.exists(key);
        } catch (e) {
          console.error(`Redis EXISTS error for ${key}:`, e);
          return 0;
        }
      },
      ttl: async (key: string) => {
        try {
          return await client.ttl(key);
        } catch (e) {
          console.error(`Redis TTL error for ${key}:`, e);
          return -2;
        }
      },
    };

    console.log("✓ Redis initialized successfully");
    return redisInstance;
  } catch (e) {
    console.error("Failed to initialize Redis:", e);
    // Graceful degradation: cache disabled
    config.strategy = "DISABLED";
    return null;
  }
}

/**
 * Get cached data, return null if not found
 */
export async function getCache(key: string): Promise<any> {
  if (config.strategy === "DISABLED" || !redisInstance) return null;

  try {
    const cached = await redisInstance.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    await logCacheOperation({ type: "MISS", key, table: extractTable(key) });
    return null;
  } catch (e) {
    console.error(`Cache GET error for ${key}:`, e);
    return null;
  }
}

/**
 * Set cached data with TTL
 */
export async function setCache(
  key: string,
  data: any,
  ttlSeconds?: number,
): Promise<void> {
  if (config.strategy === "DISABLED" || !redisInstance) return;

  try {
    const ttl = ttlSeconds || config.ttl.query;
    await redisInstance.set(key, JSON.stringify(data), ttl);
  } catch (e) {
    console.error(`Cache SET error for ${key}:`, e);
  }
}

/**
 * Cache session data (Admin Panel)
 */
export async function cacheSession(
  sessionId: string,
  sessionData: any,
): Promise<void> {
  if (!redisInstance) return;

  const key = `session:${sessionId}`;
  try {
    await setCache(key, sessionData, config.ttl.session);
    console.log(`✓ Session cached: ${sessionId}`);
  } catch (e) {
    console.error(`Failed to cache session:`, e);
  }
}

/**
 * Get cached session
 */
export async function getSession(sessionId: string): Promise<any> {
  if (!redisInstance) return null;

  const key = `session:${sessionId}`;
  return getCache(key);
}

/**
 * Cache active token for a user
 */
export async function cacheActiveUserToken(userId: string, token: string): Promise<void> {
  if (!redisInstance) return;
  const key = `active_token:${userId}`;
  await setCache(key, token, config.ttl.session);
}

/**
 * Get cached active token for a user
 */
export async function getActiveUserToken(userId: string): Promise<string | null> {
  if (!redisInstance) return null;
  const key = `active_token:${userId}`;
  return getCache(key);
}

/**
 * Cache RBAC permissions (Admin Panel)
 */
export async function cacheRBAC(
  userId: string,
  tableId: string,
  permissions: any,
): Promise<void> {
  if (!redisInstance) return;

  const key = `rbac:${userId}:${tableId}`;
  try {
    await setCache(key, permissions, config.ttl.rbac);
  } catch (e) {
    console.error(`Failed to cache RBAC:`, e);
  }
}

/**
 * Get cached RBAC
 */
export async function getRBAC(userId: string, tableId: string): Promise<any> {
  if (!redisInstance) return null;

  const key = `rbac:${userId}:${tableId}`;
  return getCache(key);
}

/**
 * Cache dashboard stats (Admin Panel, short TTL)
 */
export async function cacheDashboardStats(
  userId: string,
  stats: any,
): Promise<void> {
  if (!redisInstance) return;

  const key = `stats:dashboard:${userId}`;
  try {
    await setCache(key, stats, config.ttl.stats);
  } catch (e) {
    console.error(`Failed to cache dashboard stats:`, e);
  }
}

/**
 * Get cached dashboard stats
 */
export async function getDashboardStats(userId: string): Promise<any> {
  if (!redisInstance) return null;

  const key = `stats:dashboard:${userId}`;
  return getCache(key);
}

/**
 * Cache query results (Public API)
 */
export async function cacheQueryResult(
  tableName: string,
  filters: any,
  limit: number,
  offset: number,
  data: any,
): Promise<void> {
  if (!redisInstance) return;

  const key = buildCacheKey(tableName, { filters, limit, offset });
  try {
    await setCache(key, data, config.ttl.query);
  } catch (e) {
    console.error(`Failed to cache query result:`, e);
  }
}

/**
 * Get cached query result
 */
export async function getCachedQueryResult(
  tableName: string,
  filters: any,
  limit: number,
  offset: number,
): Promise<any> {
  if (!redisInstance) return null;

  const key = buildCacheKey(tableName, { filters, limit, offset });
  return getCache(key);
}

/**
 * Cache user-scoped query results
 */
export async function cacheUserQueryResult(
  tableName: string,
  userId: string,
  filters: any,
  limit: number,
  offset: number,
  data: any,
): Promise<void> {
  if (!redisInstance) return;

  const { buildUserScopedCacheKey } = require("../lib/cacheKeys");
  const key = buildUserScopedCacheKey(tableName, userId, { filters, limit, offset });
  try {
    await setCache(key, data, config.ttl.query);
  } catch (e) {
    console.error(`Failed to cache user query result:`, e);
  }
}

/**
 * Get cached user-scoped query result
 */
export async function getCachedUserQueryResult(
  tableName: string,
  userId: string,
  filters: any,
  limit: number,
  offset: number,
): Promise<any> {
  if (!redisInstance) return null;

  const { buildUserScopedCacheKey } = require("../lib/cacheKeys");
  const key = buildUserScopedCacheKey(tableName, userId, { filters, limit, offset });
  return getCache(key);
}

/**
 * Cache individual row
 */
export async function cacheRow(
  tableName: string,
  rowId: string,
  rowData: any,
): Promise<void> {
  if (!redisInstance) return;

  const key = `table:${tableName}:row:${rowId}`;
  try {
    await setCache(key, rowData, config.ttl.row);
  } catch (e) {
    console.error(`Failed to cache row:`, e);
  }
}

/**
 * Get cached row
 */
export async function getCachedRow(
  tableName: string,
  rowId: string,
): Promise<any> {
  if (!redisInstance) return null;

  const key = `table:${tableName}:row:${rowId}`;
  return getCache(key);
}

/**
 * Invalidate all caches for a table
 * Called on CREATE/UPDATE/DELETE
 */
export async function invalidateTableCache(tableName: string): Promise<number> {
  if (!redisInstance) return 0;

  try {
    // Delete all patterns related to this table
    const patterns = [`table:${tableName}:*`, `cache:${tableName}:*`];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const deleted = await redisInstance.scanDelete(pattern);
      totalDeleted += deleted;
    }

    // Log invalidation
    await logCacheOperation({
      type: "INVALIDATE_TABLE",
      table: tableName,
      keysCleared: totalDeleted,
    });

    console.log(
      `✓ Invalidated ${totalDeleted} cache keys for table: ${tableName}`,
    );
    return totalDeleted;
  } catch (e) {
    console.error(`Failed to invalidate table cache for ${tableName}:`, e);
    return 0;
  }
}

/**
 * Invalidate specific row cache
 */
export async function invalidateRowCache(
  tableName: string,
  rowId: string,
): Promise<void> {
  if (!redisInstance) return;

  try {
    const key = `table:${tableName}:row:${rowId}`;
    await redisInstance.del([key]);

    // Also invalidate all list queries (they might include this row)
    await redisInstance.scanDelete(`table:${tableName}:list:*`);

    console.log(`✓ Invalidated cache for row: ${tableName}/${rowId}`);
  } catch (e) {
    console.error(`Failed to invalidate row cache:`, e);
  }
}

/**
 * Invalidate user session
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  if (!redisInstance) return;

  try {
    const key = `session:${sessionId}`;
    await redisInstance.del([key]);
  } catch (e) {
    console.error(`Failed to invalidate session:`, e);
  }
}

/**
 * Invalidate RBAC cache for user
 */
export async function invalidateUserRBAC(userId: string): Promise<void> {
  if (!redisInstance) return;

  try {
    await redisInstance.scanDelete(`rbac:${userId}:*`);
    console.log(`✓ Invalidated RBAC cache for user: ${userId}`);
  } catch (e) {
    console.error(`Failed to invalidate RBAC cache:`, e);
  }
}

/**
 * Invalidate dashboard stats for user
 */
export async function invalidateDashboardStats(userId: string): Promise<void> {
  if (!redisInstance) return;

  try {
    const key = `stats:dashboard:${userId}`;
    await redisInstance.del([key]);
  } catch (e) {
    console.error(`Failed to invalidate dashboard stats:`, e);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<any> {
  if (!redisClient) {
    return { strategy: "DISABLED", redis: "not-available" };
  }

  try {
    const info = await redisClient.info("stats");
    return {
      strategy: config.strategy,
      enabled: config.strategy !== "DISABLED",
      redis: info,
    };
  } catch (e) {
    console.error("Failed to get cache stats:", e);
    return { error: "Failed to fetch stats" };
  }
}

/**
 * Clear all caches (for testing/reset)
 */
export async function clearAllCaches(): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.flushDb();
    console.log("✓ All caches cleared");
  } catch (e) {
    console.error("Failed to clear all caches:", e);
  }
}

/**
 * Set cache configuration
 */
export function setCacheConfig(newConfig: Partial<CacheConfig>): void {
  config = { ...config, ...newConfig };
  console.log("✓ Cache config updated:", config);
}

/**
 * Get current cache configuration
 */
export function getCacheConfig(): CacheConfig {
  return config;
}

/**
 * Helper: Extract table name from cache key
 */
function extractTable(key: string): string {
  const match = key.match(/^(?:table|cache):([^:]+):/);
  return match ? match[1] : "unknown";
}

/**
 * Log cache operations for audit
 */
async function logCacheOperation(operation: any): Promise<void> {
  try {
    // Audit logging can be integrated here
    // For now, just console.log for development
    if (operation.type === "HIT" || operation.type === "MISS") {
      // Verbose - optional
    } else {
      console.log(`[CACHE] ${operation.type}:`, operation);
    }
  } catch (e) {
    // Silently fail to avoid blocking cache operations
  }
}

export default {
  initializeRedis,
  getCache,
  setCache,
  cacheSession,
  getSession,
  cacheActiveUserToken,
  getActiveUserToken,
  cacheRBAC,
  getRBAC,
  cacheDashboardStats,
  getDashboardStats,
  cacheQueryResult,
  getCachedQueryResult,
  cacheUserQueryResult,
  getCachedUserQueryResult,
  cacheRow,
  getCachedRow,
  invalidateTableCache,
  invalidateRowCache,
  invalidateSession,
  invalidateUserRBAC,
  invalidateDashboardStats,
  getCacheStats,
  clearAllCaches,
  setCacheConfig,
  getCacheConfig,
};
