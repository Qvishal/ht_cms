/**
 * Cache Key Builder: Generates deterministic cache keys
 * Ensures consistent caching across requests with same parameters
 */

export interface CacheKeyOptions {
  filters?: any[];
  limit?: number;
  offset?: number;
  userId?: string;
  role?: string;
  visibilityMode?: string;
  includeDeleted?: boolean;
}

/**
 * Build cache key for table queries
 * Format: table:{tableName}:list:{filterHash}:{limit}:{offset}
 */
export function buildCacheKey(
  tableName: string,
  options: CacheKeyOptions = {}
): string {
  const filterHash = options.filters
    ? hashFilters(options.filters)
    : "all";

  const limit = options.limit || 50;
  const offset = options.offset || 0;

  return `table:${tableName}:list:${filterHash}:${limit}:${offset}`;
}

/**
 * Build cache key for individual row
 * Format: table:{tableName}:row:{rowId}
 */
export function buildRowCacheKey(tableName: string, rowId: string): string {
  return `table:${tableName}:row:${rowId}`;
}

/**
 * Build cache key for distinct values
 * Format: table:{tableName}:distinct:{field}
 */
export function buildDistinctCacheKey(tableName: string, field: string): string {
  return `table:${tableName}:distinct:${field}`;
}

/**
 * Build cache key for user-scoped data
 * Format: table:{tableName}:user:{userId}:list:{filterHash}:{limit}:{offset}
 */
export function buildUserScopedCacheKey(
  tableName: string,
  userId: string,
  options: CacheKeyOptions = {}
): string {
  const filterHash = options.filters
    ? hashFilters(options.filters)
    : "all";

  const limit = options.limit || 50;
  const offset = options.offset || 0;

  return `table:${tableName}:user:${userId}:list:${filterHash}:${limit}:${offset}`;
}

/**
 * Build pattern for invalidating all queries on a table
 * Format: table:{tableName}:*
 */
export function buildTableInvalidationPattern(tableName: string): string {
  return `table:${tableName}:*`;
}

/**
 * Build pattern for invalidating all list queries on a table
 * Format: table:{tableName}:list:*
 */
export function buildListInvalidationPattern(tableName: string): string {
  return `table:${tableName}:list:*`;
}

/**
 * Build pattern for invalidating user-scoped queries
 * Format: table:{tableName}:user:{userId}:list:*
 */
export function buildUserListInvalidationPattern(
  tableName: string,
  userId: string
): string {
  return `table:${tableName}:user:${userId}:list:*`;
}

/**
 * Hash filters for cache key generation
 * Creates consistent hash regardless of filter order
 */
function hashFilters(filters: any[]): string {
  if (!filters || filters.length === 0) return "all";

  // Normalize filters
  const normalized = filters
    .map((f) => ({
      field: f.field,
      operator: f.operator,
      value: JSON.stringify(f.value),
    }))
    .sort((a, b) => a.field.localeCompare(b.field));

  // Simple hash
  const str = JSON.stringify(normalized);
  return simpleHash(str);
}

/**
 * Simple string hash function for cache keys
 * Not cryptographically secure, just for determinism
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Parse cache key to extract information
 */
export function parseCacheKey(
  key: string
): {
  type: string;
  tableName: string;
  details: any;
} {
  // table:products:list:abc123:20:0
  const listMatch = key.match(/^table:([^:]+):list:([^:]+):(\d+):(\d+)$/);
  if (listMatch) {
    return {
      type: "list",
      tableName: listMatch[1],
      details: {
        filterHash: listMatch[2],
        limit: parseInt(listMatch[3]),
        offset: parseInt(listMatch[4]),
      },
    };
  }

  // table:products:row:abc123
  const rowMatch = key.match(/^table:([^:]+):row:(.+)$/);
  if (rowMatch) {
    return {
      type: "row",
      tableName: rowMatch[1],
      details: { rowId: rowMatch[2] },
    };
  }

  // table:products:distinct:status
  const distinctMatch = key.match(/^table:([^:]+):distinct:([^:]+)$/);
  if (distinctMatch) {
    return {
      type: "distinct",
      tableName: distinctMatch[1],
      details: { field: distinctMatch[2] },
    };
  }

  // table:products:user:user123:list:abc123:20:0
  const userScopedMatch = key.match(
    /^table:([^:]+):user:([^:]+):list:([^:]+):(\d+):(\d+)$/
  );
  if (userScopedMatch) {
    return {
      type: "user-scoped-list",
      tableName: userScopedMatch[1],
      details: {
        userId: userScopedMatch[2],
        filterHash: userScopedMatch[3],
        limit: parseInt(userScopedMatch[4]),
        offset: parseInt(userScopedMatch[5]),
      },
    };
  }

  // session:sessionId123
  const sessionMatch = key.match(/^session:(.+)$/);
  if (sessionMatch) {
    return { type: "session", tableName: "", details: { sessionId: sessionMatch[1] } };
  }

  // rbac:userId:tableId
  const rbacMatch = key.match(/^rbac:([^:]+):(.+)$/);
  if (rbacMatch) {
    return {
      type: "rbac",
      tableName: rbacMatch[2],
      details: { userId: rbacMatch[1] },
    };
  }

  // stats:dashboard:userId
  const statsMatch = key.match(/^stats:dashboard:(.+)$/);
  if (statsMatch) {
    return { type: "stats", tableName: "", details: { userId: statsMatch[1] } };
  }

  return { type: "unknown", tableName: "", details: {} };
}

/**
 * Build query string for Varnish cache control
 * Returns appropriate Cache-Control header
 */
export function getVarnishCacheControl(
  isPublic: boolean,
  isSensitive: boolean,
  ttlSeconds: number = 120
): string {
  if (isSensitive) {
    return "no-cache, no-store, must-revalidate";
  }

  if (!isPublic) {
    return `private, max-age=${Math.min(ttlSeconds, 300)}`;
  }

  return `public, max-age=${ttlSeconds}`;
}

/**
 * Check if response should be cached by Varnish
 */
export function shouldCacheInVarnish(
  method: string,
  isAuthenticated: boolean,
  isPublicRoute: boolean,
  isSensitiveTable: boolean
): boolean {
  // Only cache GET requests
  if (method !== "GET") return false;

  // Don't cache authenticated requests in Varnish
  if (isAuthenticated) return false;

  // Cache only public routes
  if (!isPublicRoute) return false;

  // Don't cache sensitive tables
  if (isSensitiveTable) return false;

  return true;
}

/**
 * Check if response should be cached in Redis
 */
export function shouldCacheInRedis(
  method: string,
  isPublic: boolean,
  isSensitive: boolean
): boolean {
  // Only cache GET requests
  if (method !== "GET") return false;

  // Don't cache sensitive tables
  if (isSensitive) return false;

  // Can cache both public and private in Redis
  return true;
}

export default {
  buildCacheKey,
  buildRowCacheKey,
  buildDistinctCacheKey,
  buildUserScopedCacheKey,
  buildTableInvalidationPattern,
  buildListInvalidationPattern,
  buildUserListInvalidationPattern,
  parseCacheKey,
  getVarnishCacheControl,
  shouldCacheInVarnish,
  shouldCacheInRedis,
};
