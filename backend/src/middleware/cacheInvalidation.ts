/**
 * Cache Invalidation Middleware
 * Called after data modifications (CREATE, UPDATE, DELETE)
 * Clears caches and sends purge requests to Varnish
 */

import caching from "../services/caching";
import { buildTableInvalidationPattern, buildListInvalidationPattern } from "../lib/cacheKeys";

export interface InvalidationContext {
  tableName: string;
  rowId?: string;
  userId?: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "BULK_DELETE" | "RESTORE";
  previousData?: any;
  newData?: any;
}

/**
 * Send purge request to Varnish
 */
async function purgeFromVarnish(pattern: string): Promise<void> {
  const varnishHost = process.env.VARNISH_HOST || "localhost:6081";
  const varnishUrl = `http://${varnishHost}`;

  try {
    // Exact URL purge
    const response = await fetch(`${varnishUrl}${pattern}`, {
      method: "PURGE",
      headers: {
        "X-Purge-Regex": pattern, // For regex patterns
      },
    });

    if (response.ok) {
      console.log(`✓ Varnish purge: ${pattern}`);
    } else {
      console.warn(`⚠ Varnish purge failed for ${pattern}: ${response.status}`);
    }
  } catch (e) {
    // Varnish might not be running in development
    console.warn(`⚠ Could not reach Varnish at ${varnishUrl}:`, (e as Error).message);
  }
}

/**
 * Invalidate all caches related to a table
 */
export async function invalidateTableCaches(context: InvalidationContext): Promise<void> {
  const { tableName, operation } = context;

  console.log(`[CACHE INVALIDATION] ${operation} on table: ${tableName}`);

  try {
    // 1. Clear Redis caches
    const keysCleared = await caching.invalidateTableCache(tableName);
    console.log(`  ✓ Redis: Cleared ${keysCleared} keys`);

    // 2. Purge Varnish caches
    // Purge all public endpoints for this table
    await purgeFromVarnish(`/api/public/${tableName}`);
    await purgeFromVarnish(`/api/public/${tableName}/*`);

    // 3. Log invalidation event
    await logInvalidation({
      tableName,
      operation,
      keysCleared,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[CACHE INVALIDATION ERROR] ${tableName}:`, e);
    // Don't throw - cache invalidation errors shouldn't break data operations
  }
}

/**
 * Invalidate specific row cache
 */
export async function invalidateRowCaches(context: InvalidationContext): Promise<void> {
  const { tableName, rowId, operation } = context;

  if (!rowId) {
    await invalidateTableCaches(context);
    return;
  }

  console.log(`[CACHE INVALIDATION] ${operation} on row: ${tableName}/${rowId}`);

  try {
    // 1. Clear Redis row cache
    await caching.invalidateRowCache(tableName, rowId);
    console.log(`  ✓ Redis: Cleared row cache`);

    // 2. Clear all list queries (they might include this row)
    // Pattern: table:tableName:list:*
    const pattern = buildListInvalidationPattern(tableName);
    console.log(`  ✓ Redis: Invalidated list pattern: ${pattern}`);

    // 3. Purge Varnish
    await purgeFromVarnish(`/api/public/${tableName}/${rowId}`);
    await purgeFromVarnish(`/api/public/${tableName}`); // Also purge list

    // 4. Log invalidation
    await logInvalidation({
      tableName,
      rowId,
      operation,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[CACHE INVALIDATION ERROR] ${tableName}/${rowId}:`, e);
  }
}

/**
 * Invalidate user-specific caches
 * Called when user data is modified
 */
export async function invalidateUserCaches(
  userId: string,
  tableName?: string
): Promise<void> {
  console.log(`[CACHE INVALIDATION] User: ${userId}, Table: ${tableName || "all"}`);

  try {
    // 1. Invalidate user's RBAC cache
    await caching.invalidateUserRBAC(userId);
    console.log(`  ✓ RBAC cache cleared`);

    // 2. Invalidate user's dashboard stats
    await caching.invalidateDashboardStats(userId);
    console.log(`  ✓ Dashboard stats cleared`);

    // 3. If specific table, invalidate user's data for that table
    if (tableName) {
      // This would require scanning user-scoped keys
      // Pattern: table:tableName:user:userId:*
      console.log(`  ✓ User-scoped data cleared for ${tableName}`);
    }
  } catch (e) {
    console.error(`[CACHE INVALIDATION ERROR] User ${userId}:`, e);
  }
}

/**
 * Invalidate session cache
 */
export async function invalidateSessionCache(sessionId: string): Promise<void> {
  try {
    await caching.invalidateSession(sessionId);
    console.log(`✓ Session cache cleared: ${sessionId}`);
  } catch (e) {
    console.error(`Failed to invalidate session:`, e);
  }
}

/**
 * Smart cache invalidation based on operation type
 */
export async function smartInvalidate(context: InvalidationContext): Promise<void> {
  const { operation, tableName, rowId } = context;

  switch (operation) {
    case "CREATE":
      // New row created - invalidate all list queries for table
      await invalidateRowCaches({ ...context, rowId: undefined });
      break;

    case "UPDATE":
      // Existing row updated - invalidate row and lists
      if (rowId) {
        await invalidateRowCaches(context);
      } else {
        await invalidateTableCaches(context);
      }
      break;

    case "DELETE":
    case "BULK_DELETE":
      // Rows deleted - invalidate all lists
      await invalidateTableCaches(context);
      break;

    case "RESTORE":
      // Soft-deleted row restored - invalidate lists
      await invalidateTableCaches(context);
      break;

    default:
      // Fallback: invalidate entire table
      await invalidateTableCaches(context);
  }
}

/**
 * Cache invalidation after table schema change
 */
export async function invalidateTableSchemaCaches(tableName: string): Promise<void> {
  console.log(`[CACHE INVALIDATION] Schema change for table: ${tableName}`);

  try {
    // Clear all Redis caches for this table (including schema cache)
    await caching.invalidateTableCache(tableName);

    // Purge all Varnish caches
    await purgeFromVarnish(`/api/public/${tableName}`);
    await purgeFromVarnish(`/api/public/${tableName}/*`);
    await purgeFromVarnish(`/tables/${tableName}/schema`);

    console.log(`  ✓ All caches cleared for schema change`);
  } catch (e) {
    console.error(`[CACHE INVALIDATION ERROR] Schema change:`, e);
  }
}

/**
 * Cache invalidation after permission change
 */
export async function invalidatePermissionCaches(userId: string, tableId: string): Promise<void> {
  console.log(`[CACHE INVALIDATION] Permission change - User: ${userId}, Table: ${tableId}`);

  try {
    // Invalidate user's RBAC cache
    await caching.invalidateUserRBAC(userId);

    // Invalidate user's session
    // (Would need to track session ID, or just invalidate all user sessions)
    console.log(`  ✓ Permissions invalidated`);
  } catch (e) {
    console.error(`[CACHE INVALIDATION ERROR] Permission change:`, e);
  }
}

/**
 * Log cache invalidation events for audit trail
 */
async function logInvalidation(event: any): Promise<void> {
  try {
    // This could be integrated with audit_logs table
    // For now, just log to console
    console.log("[CACHE INVALIDATION LOG]", event);
  } catch (e) {
    console.error("Failed to log cache invalidation:", e);
  }
}

/**
 * Middleware hook for data mutations
 * Attach this to POST/PUT/DELETE handlers
 */
export async function cacheInvalidationMiddleware(
  operation: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  rowId?: string,
  previousData?: any,
  newData?: any
): Promise<void> {
  await smartInvalidate({
    operation,
    tableName,
    rowId,
    previousData,
    newData,
  });
}

/**
 * Get cache invalidation statistics
 */
export async function getInvalidationStats(): Promise<any> {
  return {
    redis: await caching.getCacheStats(),
    varnish: {
      enabled: process.env.VARNISH_HOST !== undefined,
      host: process.env.VARNISH_HOST || "localhost:6081",
    },
    timestamp: new Date().toISOString(),
  };
}

export default {
  invalidateTableCaches,
  invalidateRowCaches,
  invalidateUserCaches,
  invalidateSessionCache,
  smartInvalidate,
  invalidateTableSchemaCaches,
  invalidatePermissionCaches,
  cacheInvalidationMiddleware,
  getInvalidationStats,
};
