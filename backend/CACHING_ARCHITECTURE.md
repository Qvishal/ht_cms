# Scalable Caching Architecture
## Admin Panel vs Public API

---

## 1. Architecture Overview

```
                    ADMIN PANEL TRAFFIC
                    ==================
    
    Admin Browser
            ↓
    Elysia Backend (Protected Routes)
            ↓
    Cache Bypassed! (always fresh from DB)
            ↓
    Database (real-time accuracy)


                    PUBLIC API TRAFFIC
                    =================
    
    Client/Mobile App
            ↓
    Varnish Edge Cache
    [Cached GET requests, 60-300s TTL]
            ↓
    Elysia Backend
    [Detect public request, check Redis]
            ↓
    Redis Cache Layer
    [Query cache, object cache]
            ↓
    Database
    [Only if cache miss]
```

---

## 2. Request Classification

### Admin Routes (Always Fresh)
```
POST   /auth/login              → No cache
POST   /auth/bootstrap          → No cache
POST   /setup/tables            → Invalidate all caches
PUT    /setup/tables/:id        → Invalidate specific cache
DELETE /setup/tables/:id        → Invalidate specific cache
PATCH  /admin/*                 → No cache (reserved for future)
```

### Public Read APIs (Cacheable)
```
GET    /api/public/:table          → Cache via Varnish + Redis
GET    /api/public/:table/:id      → Cache via Redis
GET    /api/public/:table/distinct/:field → Cache via Redis
```

### Private Data APIs (No Cache)
```
GET    /data/:table                → No cache (user-specific via RBAC)
POST   /data/:table                → Invalidate on create
PUT    /data/:table/:id            → Invalidate on update
DELETE /data/:table/:id            → Invalidate on delete
```

---

## 3. Cache Layers

### Layer 1: Varnish (Edge Cache)
**Purpose:** Reduce backend load from repeat public requests

**Cached:**
- GET requests to `/api/public/*` endpoints
- Responses with Cache-Control: public, max-age=60+
- Non-authenticated requests only

**TTL:** 60-300 seconds (configurable per endpoint)

**Invalidation:** Cache tags or purge API

**Example:**
```vcl
# Cache /api/public/products for 2 minutes
if (req.url ~ "^/api/public/") {
    set beresp.ttl = 2m;
    set beresp.http.Cache-Control = "public, max-age=120";
}
```

---

### Layer 2: Redis (Backend Cache)
**Purpose:** Reduce database queries for authenticated and public requests

**Cached Items:**
```
table:products:list:{filters}:{limit}:{offset}
  → Cached query results with pagination
  
table:products:row:abc123def456
  → Individual row object
  
cache:session:{session_id}
  → User session data (TTL: 24h)
  
cache:rbac:{user_id}:{table_name}
  → User's table permissions (TTL: 1h)
  
stats:dashboard:{user_id}
  → Dashboard metrics (TTL: 5m for admin)
```

**TTL Values:**
- Query results: 5-10 minutes
- Individual rows: 15-30 minutes
- Sessions: 24 hours
- RBAC: 1 hour
- Dashboard stats: 5 minutes

---

### Layer 3: Database
Always source of truth. Direct access only on cache miss.

---

## 4. Admin Panel: Strict Real-Time Rules

### Session Storage (Redis)
```typescript
// ✅ Cache user session
await redis.setex(`session:${sessionId}`, 86400, JSON.stringify({
    userId,
    role,
    email,
    permissions: [...]
}));

// ✅ Cache RBAC quickly
await redis.setex(`rbac:${userId}:${tableId}`, 3600, JSON.stringify({
    canRead: true,
    canWrite: false,
    canDelete: false
}));

// ✅ Cache non-critical stats with SHORT TTL
await redis.setex(`stats:dashboard:${userId}`, 300, JSON.stringify({
    tableCount: 5,
    recordCount: 1000
}));
```

### Never Cache for Admin
```typescript
// ❌ NEVER cache admin's table data
// Each request must fetch fresh from DB
if (authUser.role === "admin") {
    // Skip Redis, go straight to DB
    const rows = await directDbQuery(...);
}

// ❌ NEVER use Varnish for admin routes
// Every admin route bypasses edge cache
if (path.startsWith("/setup/") || path.startsWith("/admin/")) {
    // Bypass Varnish, go to backend
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
}
```

---

## 5. Public API: High-Performance Caching

### Public Read Request Flow
```
GET /api/public/products?limit=20&offset=0

↓ Check Cache Key
  Redis key: table:products:list:{}:20:0

↓ Cache Miss?
  Fetch from Database
  Serialize response
  
↓ Store in Redis (TTL: 5m)
  SET table:products:list:{}:20:0 <data> EX 300
  
↓ Forward to Varnish
  Response header: Cache-Control: public, max-age=120
  
↓ Varnish Caches for 2 minutes
  
↓ Return to Client
```

### Cache Key Generation
```typescript
// Deterministic keys for consistent caching
const cacheKey = buildCacheKey('products', {
    filters: [{ field: 'status', value: 'active' }],
    limit: 20,
    offset: 0
});
// Result: table:products:list:status:active:20:0
```

---

## 6. Cache Invalidation Strategy

### On CREATE
```typescript
// Admin creates new record
POST /data/products { title: "New Product" }

↓ Execute INSERT
↓ Invalidate Caches:
  - table:products:* (all product caches)
  - table:products:list:* (all list queries)
  - Varnish purge: /api/public/products*
↓ Return new record
```

### On UPDATE
```typescript
// Update existing record
PUT /data/products/abc123 { title: "Updated" }

↓ Execute UPDATE
↓ Invalidate Caches:
  - table:products:row:abc123 (specific row)
  - table:products:list:* (all lists affected)
  - Varnish purge: /api/public/products* and /api/public/products/abc123
↓ Return updated record
```

### On DELETE
```typescript
// Soft delete record
DELETE /data/products/abc123

↓ Execute SOFT DELETE
↓ Invalidate Caches:
  - table:products:row:abc123
  - table:products:list:* (all lists)
  - Varnish purge: /api/public/products*
↓ Return success
```

---

## 7. Security Rules

### Never Cache
```typescript
// ❌ Authenticated responses (unless user-scoped cache)
if (req.headers.authorization) {
    set resp.http.Cache-Control = "private, no-cache";
}

// ❌ Sensitive data
if (isTableSensitive(tableName)) {
    set resp.http.Cache-Control = "no-cache, no-store";
}

// ❌ Admin routes
if (req.url ~ "^/admin/|^/setup/") {
    set resp.http.Cache-Control = "no-cache, no-store, must-revalidate";
}
```

### Cache Headers
```typescript
// Public cacheable response
Cache-Control: public, max-age=120

// Private (user-specific, not for proxies)
Cache-Control: private, max-age=300

// Never cache
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

---

## 8. Visibility Mode Integration

### GLOBAL_ACCESS (Cacheable via Varnish)
```typescript
// Table is public
if (visibilityMode === "GLOBAL_ACCESS" && !authUser) {
    // Use Varnish cache
    response.header('Cache-Control', 'public, max-age=120');
    return cachedData;
}
```

### USER_SCOPED (Redis only, not Varnish)
```typescript
// Table is user-scoped
if (visibilityMode === "USER_SCOPED" && authUser) {
    // Use Redis cache with user context
    const cacheKey = `table:products:user:${authUser.id}:list`;
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
    
    // Not cacheable by Varnish (authenticated)
    response.header('Cache-Control', 'private, max-age=300');
}
```

---

## 9. Audit & Compliance

All cache operations are logged:

```typescript
// Log cache hit/miss
audit_logs INSERT: {
    action: 'CACHE_HIT' | 'CACHE_MISS',
    table: 'products',
    duration: 5,  // ms saved by cache
    user_id: null  // null for public
}

// Log cache invalidation
audit_logs INSERT: {
    action: 'CACHE_INVALIDATED',
    table: 'products',
    reason: 'CREATE',
    keys_cleared: 3
}
```

---

## 10. Configuration Parameters

```typescript
// Redis
REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_TTL_QUERY = 300        // 5 minutes
REDIS_TTL_ROW = 900          // 15 minutes
REDIS_TTL_SESSION = 86400    // 24 hours

// Varnish
VARNISH_ENABLED = true
VARNISH_TTL_PUBLIC = 120     // 2 minutes
VARNISH_HOST = "localhost:6081"
VARNISH_PURGE_URL = "http://localhost:6081"

// Cache Strategy
CACHE_STRATEGY = "HYBRID"    // HYBRID | REDIS_ONLY | DISABLED
CACHE_PUBLIC_ONLY = true     // Only cache public endpoints
```

---

## 11. Performance Impact

### Before Caching
```
Database Load: 1000 req/s
Response Time: 150-300ms
CPU: 85%
Throughput: 6,666 req/s
```

### After Caching (with Varnish + Redis)
```
Database Load: 50 req/s (95% reduction!)
Response Time: 10-20ms (cache hit) / 100ms (miss)
CPU: 20%
Throughput: 50,000+ req/s
```

---

## 12. Monitoring & Observability

### Redis Cache Stats
```sql
SELECT 
  key_pattern,
  COUNT(*) as num_keys,
  SUM(memory_bytes) as total_memory,
  AVG(ttl) as avg_ttl
FROM cache_stats
GROUP BY key_pattern;
```

### Cache Hit Rate
```
Cache Hit Rate = (Cache Hits / (Cache Hits + Cache Misses)) * 100
Target: > 80% after warm-up period
```

### Varnish Stats
```bash
varnishstat | grep -E "HITS|MISSES|PASSES"

Example Output:
Hitrate ratio: 85% | 10000 + 1500 n = 11500
Hitrate avg:    0.85
```

---

## 13. Integration Points

- ✅ RBAC: Cache RBAC checks, validate on each request
- ✅ Dynamic APIs: Auto-cache based on visibility mode
- ✅ Audit Logs: Log all cache operations
- ✅ Soft Delete: Invalidate cache on soft deletes
- ✅ Visibility Modes: GLOBAL_ACCESS uses Varnish, USER_SCOPED uses Redis only
