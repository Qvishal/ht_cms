# Cache Implementation Quick Reference

## Core Principle
```
ADMIN PANEL         →  Real-time, no cache
PUBLIC API          →  High performance, fully cached
```

---

## Default TTL Values

| Cache Type | TTL | Purpose |
|---|---|---|
| Query Results | 5 min | List endpoint queries |
| Individual Rows | 15 min | Single row fetches |
| Sessions | 24 hours | User sessions |
| RBAC | 1 hour | Permission checks |
| Dashboard Stats | 5 min | Admin metrics |

---

## Import Statements

```typescript
import caching from "./services/caching";
import cacheInvalidation from "./middleware/cacheInvalidation";
import { buildCacheKey, shouldCacheInVarnish } from "./lib/cacheKeys";
```

---

## Quick Code Patterns

### 1. Get Cached Data
```typescript
// Query result
let data = await caching.getCachedQueryResult(table, filters, limit, offset);

// Individual row
let row = await caching.getCachedRow(table, rowId);

// Session
let session = await caching.getSession(sessionId);

// RBAC
let perms = await caching.getRBAC(userId, tableId);
```

### 2. Set Cache
```typescript
// Query result
await caching.cacheQueryResult(table, filters, limit, offset, data);

// Individual row
await caching.cacheRow(table, rowId, rowData);

// Session
await caching.cacheSession(sessionId, userData);

// RBAC
await caching.cacheRBAC(userId, tableId, permissions);
```

### 3. Invalidate Cache
```typescript
// Smart (detects operation type)
await cacheInvalidation.smartInvalidate({
    operation: "UPDATE",
    tableName: "products",
    rowId: "123",
});

// Specific
await caching.invalidateTableCache("products");
await caching.invalidateRowCache("products", "123");
await caching.invalidateUserRBAC("userId");
```

---

## Cache Headers Cheat Sheet

| Response Type | Header |
|---|---|
| Public cacheable | `Cache-Control: public, max-age=120` |
| Private cacheable | `Cache-Control: private, max-age=300` |
| Never cache | `Cache-Control: no-cache, no-store, must-revalidate` |
| Cache bust | `Pragma: no-cache` + `Expires: 0` |

---

## Endpoint Patterns

### Public Read (Cached)
```typescript
.get("/api/public/:table", async ({ params, set }) => {
    const cached = await caching.getCachedQueryResult(...);
    if (cached) {
        set.header("Cache-Control", "public, max-age=120");
        set.header("X-Cache", "HIT");
        return cached;
    }
    
    const data = await fetchFromDb(...);
    await caching.cacheQueryResult(...);
    
    set.header("Cache-Control", "public, max-age=120");
    set.header("X-Cache", "MISS");
    return data;
})
```

### Data Mutation (Invalidates Cache)
```typescript
.post("/data/:table", async ({ params, body, authUser, set }) => {
    // Create row
    const newRow = await createRow(...);
    
    // Invalidate cache
    await cacheInvalidation.smartInvalidate({
        operation: "CREATE",
        tableName: params.table,
    });
    
    return { row: newRow };
})
```

### Admin Route (No Cache)
```typescript
.post("/setup/tables", async ({ authUser, set }) => {
    // Never cache admin routes
    set.header("Cache-Control", "no-cache, no-store, must-revalidate");
    
    // Create table...
    
    // Invalidate schema cache
    await cacheInvalidation.invalidateTableSchemaCaches(tableName);
})
```

---

## Redis CLI Debugging

```bash
# Check all keys
redis-cli KEYS "*"

# Check specific table cache
redis-cli KEYS "table:products:*"

# Get value
redis-cli GET "table:products:list:abc123:20:0"

# Get TTL (seconds remaining)
redis-cli TTL "table:products:list:abc123:20:0"

# Delete key
redis-cli DEL "table:products:list:abc123:20:0"

# Clear all
redis-cli FLUSHDB

# Check memory
redis-cli INFO memory

# Monitor live commands
redis-cli MONITOR
```

---

## Cache Statistics

```typescript
// Get cache stats
const stats = await caching.getCacheStats();
// Returns: Redis info, configuration, status

// Get invalidation stats
const invStats = await cacheInvalidation.getInvalidationStats();
// Returns: Redis enabled, Varnish config, timestamp
```

---

## Common Operations

### Add Caching to Existing Endpoint

```diff
.get("/data/:table", async ({ params, query, authUser, set }) => {
+   // Cache check
+   const cacheKey = buildCacheKey(params.table, { limit, offset });
+   let result = await caching.getCachedQueryResult(params.table, {}, limit, offset);
+   if (result) {
+     set.header("Cache-Control", "public, max-age=120");
+     return result;
+   }

    // Existing logic
    const rows = await listRows(...);

+   // Cache store
+   await caching.cacheQueryResult(params.table, {}, limit, offset, { rows });
+   set.header("Cache-Control", "public, max-age=120");
    return { rows };
})
```

### Add Invalidation to Mutation

```diff
.post("/data/:table", async ({ params, body, authUser }) => {
    // Existing logic
    const newRow = await createRow(...);

+   // Invalidate cache
+   await cacheInvalidation.smartInvalidate({
+     operation: "CREATE",
+     tableName: params.table,
+   });

    return { row: newRow };
})
```

---

## Environment Variables

```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# Varnish
VARNISH_ENABLED=true
VARNISH_HOST=localhost:6081

# Cache Strategy
CACHE_STRATEGY=HYBRID        # HYBRID | REDIS_ONLY | DISABLED
CACHE_PUBLIC_ONLY=true       # Only cache /api/public/*
```

---

## Docker Commands

```bash
# Start Redis
docker-compose up -d redis

# Access Redis
docker-compose exec redis redis-cli

# View logs
docker-compose logs -f redis

# Stop
docker-compose down
```

---

## Testing Quick Commands

```bash
# Test cache miss
curl -v http://localhost:4000/api/public/products | jq . 
# Header: X-Cache: MISS

# Test cache hit (immediate call)
curl -v http://localhost:4000/api/public/products | jq .
# Header: X-Cache: HIT

# Test invalidation
curl -X POST http://localhost:4000/data/products \
  -H "Authorization: Bearer $TOKEN" \
  -d '{...}'

# Test again (should be miss)
curl -v http://localhost:4000/api/public/products | jq .
# Header: X-Cache: MISS
```

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---|---|
| Redis not connecting | `redis-cli ping` to verify running |
| Cache not working | Check `CACHE_STRATEGY` in `.env` is not `DISABLED` |
| Cache not invalidating | Verify `cacheInvalidation.smartInvalidate()` called |
| Old data served | Run `redis-cli FLUSHDB` to clear cache |
| High memory | Reduce TTL or decrease max keys |
| Slow queries | Check if Varnish enabled, verify DB indexes |

---

## Cache Key Naming Convention

```
Type          Pattern
─────────────────────────────────────────
Query         table:{name}:list:{hash}:{limit}:{offset}
Row           table:{name}:row:{id}
Distinct      table:{name}:distinct:{field}
User-scoped   table:{name}:user:{userId}:list:{hash}:{limit}:{offset}
Session       session:{id}
RBAC          rbac:{userId}:{tableId}
Stats         stats:dashboard:{userId}
```

---

## File Locations

```
Cache System Files:
├── src/services/caching.ts              (Redis operations)
├── src/middleware/cacheInvalidation.ts  (Invalidation logic)
├── src/lib/cacheKeys.ts                 (Key builder utilities)
└── config/varnish.vcl                   (Varnish config)

Documentation Files:
├── CACHING_ARCHITECTURE.md              (Design overview)
├── CACHING_INTEGRATION.md               (Integration guide)
├── CACHE_IMPLEMENTATION_PATCHES.md      (Code snippets)
├── CACHE_DOCKER_SETUP.md               (Docker setup)
├── CACHE_SYSTEM_SUMMARY.md             (This summary)
└── CACHE_QUICK_REFERENCE.md            (Quick reference)

Package:
└── package.json                         (Add: redis, @elysiajs/redis)
```

---

## Performance Targets

| Metric | Target |
|---|---|
| Cache Hit Rate | > 80% after warm-up |
| Response Time (hit) | < 50ms |
| Response Time (miss) | 100-300ms |
| DB Load Reduction | 90%+ |
| Memory Usage | < 256MB (configurable) |

---

## Remember

✅ Do:
- Cache GET requests only
- Invalidate on CREATE/UPDATE/DELETE
- Use deterministic cache keys
- Set proper TTLs
- Monitor cache stats

❌ Don't:
- Cache authenticated responses (without user context)
- Forget to invalidate
- Cache admin routes
- Use non-deterministic keys
- Cache sensitive data

---

That's it! You have everything you need to implement production-grade caching. 🚀
