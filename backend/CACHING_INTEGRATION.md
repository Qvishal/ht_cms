# Caching System Integration Guide

## Overview
This guide explains how to integrate the caching architecture into your existing Elysia backend.

---

## 1. Core Integration Steps

### Step 1: Initialize Redis in index.ts

At the top of `src/index.ts`, add:

```typescript
import caching from "./services/caching";
import cacheInvalidation from "./middleware/cacheInvalidation";
import { buildCacheKey, shouldCacheInVarnish } from "./lib/cacheKeys";

// Initialize Redis when app starts
await caching.initializeRedis();

// Set cache configuration
caching.setCacheConfig({
  strategy: "HYBRID", // or "REDIS_ONLY" for development
  publicOnly: true, // Only cache /api/public/* endpoints
  ttl: {
    query: 300, // 5 minutes
    row: 900, // 15 minutes  
    session: 86400, // 24 hours
    rbac: 3600, // 1 hour
    stats: 300, // 5 minutes
  },
});
```

### Step 2: Add Redis Plugin to Elysia App

```typescript
import redis from "@elysiajs/redis";

const app = new Elysia()
  .use(redis())
  .use(cors())
  // ... rest of plugins
```

---

## 2. Admin Panel: Bypass Caching

### Session Management

For login endpoint, cache session after successful authentication:

```typescript
.post("/auth/login", async ({ body, set }) => {
  // ... authenticate user ...
  
  const token = jwt.sign({ userId, role });
  const sessionId = generateId();
  
  // Cache session in Redis
  await caching.cacheSession(sessionId, {
    userId,
    role,
    email,
    createdAt: new Date(),
  });
  
  return {
    token,
    sessionId,
    user: { id: userId, email, role },
  };
})
```

### Cache RBAC

After checking user permissions:

```typescript
// Inside permission check middleware
const permissions = await checkTablePermissions(userId, tableId);

// Cache for 1 hour
await caching.cacheRBAC(userId, tableId, permissions);
```

### Admin Routes: Never Cache Data

For admin setup and edit routes, ensure cache is bypassed:

```typescript
.post("/setup/tables", async ({ body, set, authUser }) => {
  if (authUser.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }
  
  // Add table...
  
  // Invalidate all caches (schema changed)
  await cacheInvalidation.invalidateTableSchemaCaches(body.name);
  
  set.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return { table: newTable };
})

.put("/setup/tables/:id", async ({ params, body, set, authUser }) => {
  if (authUser.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }
  
  // Update table...
  
  // Invalidate caches for this table
  const tableName = getTableName(params.id);
  await cacheInvalidation.invalidateTableSchemaCaches(tableName);
  
  set.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return { table: updatedTable };
})
```

---

## 3. Public API: Implement Caching

### READ Endpoints (Cacheable)

For GET endpoints serving public data:

```typescript
.get("/api/public/:table", async ({ params, query, set }) => {
  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(query.limit);
  const offset = z.coerce.number().int().min(0).catch(0).parse(query.offset);
  
  // Try to get from Redis cache
  const cacheKey = buildCacheKey(params.table, { limit, offset });
  let cachedResult = await caching.getCachedQueryResult(params.table, {}, limit, offset);
  
  if (cachedResult) {
    set.header("X-Cache", "HIT");
    set.header("Cache-Control", "public, max-age=120");
    return cachedResult;
  }
  
  // Cache miss - fetch from database
  const rows = await listRows(params.table, limit, offset, {
    userId: null,
    isAdmin: false,
    visibilityMode: "GLOBAL_ACCESS",
    includeDeleted: false,
  });
  
  // Cache the result
  await caching.cacheQueryResult(params.table, {}, limit, offset, { rows });
  
  set.header("X-Cache", "MISS");
  set.header("Cache-Control", "public, max-age=120");
  return { rows };
})

.get("/api/public/:table/:id", async ({ params, set }) => {
  // Try Redis cache for individual row
  let cachedRow = await caching.getCachedRow(params.table, params.id);
  
  if (cachedRow) {
    set.header("X-Cache", "HIT");
    set.header("Cache-Control", "public, max-age=300");
    return { row: cachedRow };
  }
  
  // Fetch from database
  const row = await getRow(params.table, params.id, {
    userId: null,
    isAdmin: false,
    visibilityMode: "GLOBAL_ACCESS",
    includeDeleted: false,
  });
  
  if (!row) {
    set.status = 404;
    return { error: "Not found" };
  }
  
  // Cache individual row (longer TTL)
  await caching.cacheRow(params.table, params.id, row);
  
  set.header("X-Cache", "MISS");
  set.header("Cache-Control", "public, max-age=300");
  return { row };
})
```

### WRITE Endpoints (Invalidate Cache)

For POST/PUT/DELETE operations:

```typescript
.post("/data/:table", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  // Validate and create row
  const newRow = await createRow(params.table, body, {
    createdBy: authUser.id,
    createdAt: new Date(),
  });
  
  // Invalidate cache AFTER successful creation
  await cacheInvalidation.smartInvalidate({
    operation: "CREATE",
    tableName: params.table,
    newData: newRow,
  });
  
  return { row: newRow };
})

.put("/data/:table/:id", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  // Get original data for audit
  const previousData = await getRow(params.table, params.id, {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode: "ALL",
  });
  
  // Update row
  const updatedRow = await updateRow(params.table, params.id, body, {
    updatedBy: authUser.id,
    updatedAt: new Date(),
  });
  
  // Invalidate cache AFTER successful update
  await cacheInvalidation.smartInvalidate({
    operation: "UPDATE",
    tableName: params.table,
    rowId: params.id,
    previousData,
    newData: updatedRow,
  });
  
  return { row: updatedRow };
})

.delete("/data/:table/:id", async ({ params, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  // Soft delete
  const deletedRow = await softDeleteRow(params.table, params.id, {
    deletedBy: authUser.id,
    deletedAt: new Date(),
  });
  
  // Invalidate cache AFTER successful delete
  await cacheInvalidation.smartInvalidate({
    operation: "DELETE",
    tableName: params.table,
    rowId: params.id,
  });
  
  return { success: true };
})
```

---

## 4. Private Data APIs: User-Scoped Caching

For user-specific data endpoints:

```typescript
.get("/data/:table", async ({ params, query, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(query.limit);
  const offset = z.coerce.number().int().min(0).catch(0).parse(query.offset);
  
  // For private data, use user-scoped cache keys
  // but mark as always refetch for admin priority access
  const cacheKey = `table:${params.table}:user:${authUser.id}:list:*:${limit}:${offset}`;
  
  // Check if this is quick-access (not real-time required)
  const skipCache = query.forceFresh === "1";
  
  if (!skipCache) {
    let cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      set.header("Cache-Control", "private, max-age=300");
      return JSON.parse(cachedResult);
    }
  }
  
  // Fetch fresh data
  const rows = await listRows(params.table, limit, offset, {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode: "USER_SCOPED",
    includeDeleted: query.includeDeleted === "1",
  });
  
  // Cache only if not admin (admins may want latest data)
  if (authUser.role !== "admin") {
    await redis.setex(cacheKey, 300, JSON.stringify({ rows }));
  }
  
  set.header("Cache-Control", "private, max-age=300");
  return { rows };
})
```

---

## 5. Cache Control Headers

Use proper Cache-Control headers in all responses:

```typescript
// Public, cacheable response
set.header("Cache-Control", "public, max-age=120");

// Private, not for proxies, but cache in Redis
set.header("Cache-Control", "private, max-age=300");

// Never cache
set.header("Cache-Control", "no-cache, no-store, must-revalidate");
set.header("Pragma", "no-cache");
set.header("Expires", "0");
```

---

## 6. Monitoring & Stats

Add cache statistics endpoint:

```typescript
.get("/admin/cache/stats", async ({ authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }
  
  const stats = await caching.getCacheStats();
  const invalidationStats = await cacheInvalidation.getInvalidationStats();
  
  return {
    redis: stats,
    invalidation: invalidationStats,
    config: caching.getCacheConfig(),
  };
})

.post("/admin/cache/clear", async ({ authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }
  
  await caching.clearAllCaches();
  
  return { success: true, message: "All caches cleared" };
})
```

---

## 7. Varnish Integration (Optional)

If you're using Varnish for edge caching:

### Docker Compose Setup

Add to `docker-compose.yml`:

```yaml
  varnish:
    image: varnish:latest
    ports:
      - "6081:80"
    volumes:
      - ./config/varnish.vcl:/etc/varnish/default.vcl
    environment:
      - VARNISH_BACKEND_HOST=backend
      - VARNISH_BACKEND_PORT=4000
    depends_on:
      - backend
```

### Start Varnish Step-by-Step

```bash
# 1. Copy Varnish config
cp config/varnish.vcl /etc/varnish/default.vcl

# 2. Start Varnish (or use Docker)
docker-compose up varnish

# 3. Test Varnish
curl -v http://localhost:6081/api/public/products

# 4. Check cache performance
varnishstat

# 5. Purge cache (for manual invalidation)
curl -X PURGE http://localhost:6081/api/public/products
```

---

## 8. Environment Variables

Add to `.env`:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# Varnish Configuration
VARNISH_ENABLED=true
VARNISH_HOST=localhost:6081

# Cache Strategy
CACHE_STRATEGY=HYBRID  # HYBRID | REDIS_ONLY | DISABLED
CACHE_PUBLIC_ONLY=true # Only cache /api/public/* endpoints
```

---

## 9. Testing Cache System

### Test Redis Cache

```bash
# 1. Call endpoint and check cache hit
curl -v http://localhost:4000/api/public/products
# Should return X-Cache: MISS

# 2. Call again immediately
curl -v http://localhost:4000/api/public/products
# Should return X-Cache: HIT (if caching works)

# 3. Modify data
curl -X POST http://localhost:4000/data/products \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"New Product"}'

# 4. Check cache was invalidated
curl -v http://localhost:4000/api/public/products
# Should return X-Cache: MISS again
```

### Test Varnish Cache

```bash
# 1. Call through Varnish
curl -v -H "X-Forwarded-For: 1.2.3.4" http://localhost:6081/api/public/products

# 2. Check cache stats
varnishstat | grep -E "HITS|MISSES"

# 3. Purge specific URL
curl -X PURGE http://localhost:6081/api/public/products

# 4. Monitor Varnish logs
varnishlog -c -o ReqURL
```

---

## 10. Performance Tuning

### Adjust TTLs Based on Your Needs

```typescript
// For frequently updated data
caching.setCacheConfig({
  ttl: {
    query: 60,  // 1 minute instead of 5
    row: 300,   // 5 minutes instead of 15
    // ...
  },
});

// For mostly-static data
caching.setCacheConfig({
  ttl: {
    query: 3600, // 1 hour
    row: 3600,   // 1 hour
    // ...
  },
});
```

### Monitor Cache Hit Rate

```bash
# Target: > 80% cache hit rate after warm-up

# Check Redis
redis-cli INFO stats

# Check Varnish
varnishstat -1 | grep "cache_hit\|cache_miss"
```

---

## 11. Troubleshooting

### Cache Not Working

1. Check Redis is running: `redis-cli ping`
2. Check logs: Look for `Redis initialized` message
3. Check cache config: Verify `strategy` is not `DISABLED`
4. Manually test: `redis-cli get "table:products:list:*"`

### Cache Not Invalidating

1. Check invalidation logs in console
2. Verify Varnish is reachable (if enabled)
3. Test manual invalidation: `await caching.invalidateTableCache('products')`

### Performance Issues

1. Monitor cache hit rate
2. Adjust TTL values if needed
3. Check Redis memory usage
4. Consider enabling only for frequently accessed tables
