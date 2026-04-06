# Cache Implementation Code Patches
## Ready-to-use code snippets for integrating cache into index.ts

---

## 1. Imports (Add to top of index.ts)

```typescript
// Caching imports
import caching from "./services/caching";
import cacheInvalidation from "./middleware/cacheInvalidation";
import { 
  buildCacheKey, 
  buildRowCacheKey,
  getVarnishCacheControl,
  shouldCacheInVarnish 
} from "./lib/cacheKeys";
```

---

## 2. Initialize Redis and Caching

**Location: After creating Elysia app instance**

```typescript
const app = new Elysia()
  .use(cors())
  .use(jwt({
    secret: jwtSecret,
    name: "authUser",
  }))
  // Add Redis plugin BEFORE using caching
  .use(redis());

// Initialize caching system
try {
  await caching.initializeRedis();
  console.log("✓ Cache system initialized");
} catch (error) {
  console.warn("⚠ Cache initialization failed:", error);
}

// Configure caching
caching.setCacheConfig({
  strategy: process.env.CACHE_STRATEGY as "HYBRID" | "REDIS_ONLY" | "DISABLED" || "HYBRID",
  publicOnly: process.env.CACHE_PUBLIC_ONLY !== "false",
  ttl: {
    query: 300,    // 5 minutes
    row: 900,      // 15 minutes
    session: 86400, // 24 hours
    rbac: 3600,    // 1 hour
    stats: 300,    // 5 minutes
  },
});
```

---

## 3. Public GET Endpoint - With Caching

**Replace existing GET /data/:table endpoint with:**

```typescript
.get("/api/public/:table", async ({ params, query, set }) => {
  // Parse pagination
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .catch(50)
    .parse(query.limit);
  const offset = z.coerce.number().int().min(0).catch(0).parse(query.offset);

  // Build cache key
  const cacheKey = buildCacheKey(params.table, { limit, offset });

  // Try Redis cache first
  const cachedRows = await caching.getCachedQueryResult(params.table, {}, limit, offset);
  if (cachedRows) {
    set.header("Cache-Control", "public, max-age=120");
    set.header("X-Cache", "HIT");
    return cachedRows;
  }

  // Cache miss - fetch from database
  const visibilityMode = await getVisibilityMode(params.table);
  
  // Only serve public tables
  if (visibilityMode !== "GLOBAL_ACCESS") {
    set.status = 403;
    return { error: "Table not publicly accessible" };
  }

  const rows = await listRows(params.table, limit, offset, {
    userId: null,
    isAdmin: false,
    visibilityMode: "GLOBAL_ACCESS",
    includeDeleted: false,
  });

  // Cache the result
  await caching.cacheQueryResult(params.table, {}, limit, offset, { rows });

  // Set Varnish cache header
  set.header("Cache-Control", "public, max-age=120");
  set.header("X-Cache", "MISS");
  return { rows };
})
```

---

## 4. Individual Row GET - With Caching

**Add new endpoint for public single row:**

```typescript
.get("/api/public/:table/:id", async ({ params, set }) => {
  // Try Redis cache for individual row
  const cachedRow = await caching.getCachedRow(params.table, params.id);
  if (cachedRow) {
    set.header("Cache-Control", "public, max-age=300");
    set.header("X-Cache", "HIT");
    return { row: cachedRow };
  }

  // Cache miss - fetch from database
  const visibilityMode = await getVisibilityMode(params.table);
  
  if (visibilityMode !== "GLOBAL_ACCESS") {
    set.status = 403;
    return { error: "Table not publicly accessible" };
  }

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

  // Cache individual row
  await caching.cacheRow(params.table, params.id, row);

  set.header("Cache-Control", "public, max-age=300");
  set.header("X-Cache", "MISS");
  return { row };
})
```

---

## 5. POST - Create with Cache Invalidation

**Update existing POST /data/:table endpoint:**

```typescript
.post("/data/:table", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized - Token required" };
  }

  await requireTableWrite(authUser, params.table);

  // Validate input
  const schema = await getTableSchema(params.table);
  const validated = validateRequestBody(body, schema);
  if (!validated.valid) {
    set.status = 400;
    return { error: "Validation failed", details: validated.errors };
  }

  // Sanitize input
  const sanitized = sanitizeInput(validated.data, schema);

  // Create row in database
  const newRow = await executeQuery(
    `INSERT INTO ${sql.ident(params.table)} (${sql(Object.keys(sanitized))}, created_by, created_at)
     VALUES (${sql(Object.values(sanitized))}, ${sql(authUser.id)}, NOW())
     RETURNING *`,
  );

  // Log audit trail
  await logAudit({
    action: "CREATE",
    userId: authUser.id,
    tableName: params.table,
    rowId: newRow.id,
    newValues: newRow,
  });

  // ✅ INVALIDATE CACHE AFTER CREATE
  await cacheInvalidation.smartInvalidate({
    operation: "CREATE",
    tableName: params.table,
    newData: newRow,
  });

  set.status = 201;
  return { row: newRow };
})
```

---

## 6. PUT - Update with Cache Invalidation

**Update existing PUT /data/:table/:id endpoint:**

```typescript
.put("/data/:table/:id", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized - Token required" };
  }

  await requireTableWrite(authUser, params.table);

  // Get previous row data for audit
  const previousRow = await getRow(params.table, params.id, {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode: "ALL",
  });

  if (!previousRow) {
    set.status = 404;
    return { error: "Not found" };
  }

  // Validate input
  const schema = await getTableSchema(params.table);
  const validated = validateRequestBody(body, schema);
  if (!validated.valid) {
    set.status = 400;
    return { error: "Validation failed", details: validated.errors };
  }

  // Sanitize and update
  const sanitized = sanitizeInput(validated.data, schema);
  const updates = Object.entries(sanitized)
    .map(([key, val]) => `${sql.ident(key)} = ${sql(val)}`)
    .join(", ");

  const updatedRow = await executeQuery(
    `UPDATE ${sql.ident(params.table)} 
     SET ${updates}, updated_by = ${sql(authUser.id)}, updated_at = NOW()
     WHERE id = ${sql(params.id)}
     RETURNING *`,
  );

  // Log audit trail
  await logAudit({
    action: "UPDATE",
    userId: authUser.id,
    tableName: params.table,
    rowId: params.id,
    previousValues: previousRow,
    newValues: updatedRow,
  });

  // ✅ INVALIDATE CACHE AFTER UPDATE
  await cacheInvalidation.smartInvalidate({
    operation: "UPDATE",
    tableName: params.table,
    rowId: params.id,
    previousData: previousRow,
    newData: updatedRow,
  });

  return { row: updatedRow };
})
```

---

## 7. DELETE - Soft Delete with Cache Invalidation

**Update existing DELETE /data/:table/:id endpoint:**

```typescript
.delete("/data/:table/:id", async ({ params, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized - Token required" };
  }

  await requireTableWrite(authUser, params.table);

  // Get row before deletion for audit
  const deletedRow = await executeQuery(
    `UPDATE ${sql.ident(params.table)} 
     SET is_deleted = true, deleted_at = NOW(), deleted_by_id = ${sql(authUser.id)}
     WHERE id = ${sql(params.id)} AND auth_deleted = false
     RETURNING *`,
  );

  if (!deletedRow) {
    set.status = 404;
    return { error: "Not found" };
  }

  // Log audit trail
  await logAudit({
    action: "DELETE",
    userId: authUser.id,
    tableName: params.table,
    rowId: params.id,
    previousValues: deletedRow,
  });

  // ✅ INVALIDATE CACHE AFTER DELETE
  await cacheInvalidation.smartInvalidate({
    operation: "DELETE",
    tableName: params.table,
    rowId: params.id,
  });

  return { success: true };
})
```

---

## 8. Bulk Delete with Cache Invalidation

**Update existing POST /data/:table/bulk-delete endpoint:**

```typescript
.post("/data/:table/bulk-delete", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized - Token required" };
  }

  if (authUser.role !== "admin") {
    set.status = 403;
    return { error: "Only admins can bulk delete" };
  }

  const { rowIds } = body as { rowIds: string[] };

  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    set.status = 400;
    return { error: "rowIds must be non-empty array" };
  }

  const deletedCount = await bulkSoftDelete(params.table, rowIds, {
    deletedBy: authUser.id,
  });

  // Log audit trail
  await logAudit({
    action: "BULK_DELETE",
    userId: authUser.id,
    tableName: params.table,
    details: { count: deletedCount, rowIds },
  });

  // ✅ INVALIDATE ENTIRE TABLE CACHE (bulk operation)
  await cacheInvalidation.smartInvalidate({
    operation: "BULK_DELETE",
    tableName: params.table,
  });

  return { deletedCount };
})
```

---

## 9. Schema Update - Full Cache Invalidation

**For POST /setup/tables endpoint:**

```typescript
.post("/setup/tables", async ({ body, authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }

  const table = await ensurePhysicalTable(body);
  
  // Ensure indexes created automatically
  await ensureTableIndexes(table.name);

  // ✅ INVALIDATE ALL CACHES FOR NEW TABLE
  // (might have been created in previous session)
  await cacheInvalidation.invalidateTableSchemaCaches(table.name);

  // Prevent caching of admin response
  set.header("Cache-Control", "no-cache, no-store, must-revalidate");
  
  return {
    table,
    message: "Table created successfully",
  };
})
```

---

## 10. Cache Management Endpoints

**Add admin-only cache management:**

```typescript
.get("/admin/cache/stats", async ({ authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }

  const redisStats = await caching.getCacheStats();
  const invalidationStats = await cacheInvalidation.getInvalidationStats();
  const config = caching.getCacheConfig();

  return {
    redis: redisStats,
    invalidation: invalidationStats,
    config,
    timestamp: new Date().toISOString(),
  };
})

.post("/admin/cache/clear", async ({ authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }

  await caching.clearAllCaches();

  await logAudit({
    action: "CACHE_CLEARED",
    userId: authUser.id,
    details: "All caches cleared",
  });

  return { success: true, message: "All caches cleared" };
})

.post("/admin/cache/invalidate/:table", async ({ params, authUser, set }) => {
  if (authUser?.role !== "admin") {
    set.status = 403;
    return { error: "Forbidden" };
  }

  const keysCleared = await caching.invalidateTableCache(params.table);

  await logAudit({
    action: "CACHE_INVALIDATED",
    userId: authUser.id,
    details: { table: params.table, keysCleared },
  });

  return { success: true, keysCleared };
})
```

---

## 11. Session Caching (Login)

**Update POST /auth/login endpoint:**

```typescript
.post("/auth/login", async ({ body, set }) => {
  const { email, password } = body as { email: string; password: string };

  const user = await getUser(email);
  if (!user) {
    set.status = 401;
    return { error: "Invalid credentials" };
  }

  const passwordMatch = await comparePassword(password, user.passwordHash);
  if (!passwordMatch) {
    set.status = 401;
    return { error: "Invalid credentials" };
  }

  // Generate JWT token
  const token = jwt.sign({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  // ✅ CACHE SESSION
  const sessionId = generateId();
  await caching.cacheSession(sessionId, {
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAt: new Date(),
  });

  // Don't cache login response
  set.header("Cache-Control", "no-cache, no-store, must-revalidate");

  return {
    token,
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
})
```

---

## 12. Middleware for Auth + RBAC Caching

**Add before protected routes:**

```typescript
// Middleware to cache RBAC checks
async function checkAndCacheRBAC(userId: string, tableId: string): Promise<any> {
  // Try to get from Redis
  const cached = await caching.getRBAC(userId, tableId);
  if (cached) {
    return cached;
  }

  // Not cached - check permissions
  const perms = await queryTablePermissions(userId, tableId);
  
  // Cache for 1 hour
  await caching.cacheRBAC(userId, tableId, perms);
  
  return perms;
}

// Use in protected routes
await checkAndCacheRBAC(authUser.id, tableId);
```

---

## 13. Headers for Cache Control

**Quick reference for all endpoint types:**

```typescript
// Public, cacheable by Varnish and browsers
set.header("Cache-Control", "public, max-age=120");

// Private, not by Varnish, but Redis cache ok
set.header("Cache-Control", "private, max-age=300");

// Admin routes, never cache
set.header("Cache-Control", "no-cache, no-store, must-revalidate");
set.header("Pragma", "no-cache");
set.header("Expires", "0");

// Include cache hit/miss for debugging
set.header("X-Cache", "HIT" | "MISS" | "PASS");
```

---

## 14. Testing the Cache Integration

```bash
# Test 1: Cache hit
$ curl -v http://localhost:4000/api/public/products | jq .
# Should see X-Cache: MISS, X-Response-Time header

# Test 2: Immediate request (should be cached)
$ curl -v http://localhost:4000/api/public/products | jq .
# Should see X-Cache: HIT

# Test 3: Create new product (invalidates cache)
$ curl -X POST http://localhost:4000/data/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"New","price":99}'
# Response: 201 created

# Test 4: Check cache was invalidated
$ curl -v http://localhost:4000/api/public/products | jq .
# Should see X-Cache: MISS again (cache was cleared)

# Test 5: Check cache stats
$ curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/admin/cache/stats | jq .
# Shows Redis stats, Varnish status, config
```

---

## Migration Checklist

- [ ] Add imports from caching services
- [ ] Initialize Redis on app startup
- [ ] Add `/api/public/:table` GET endpoint
- [ ] Add `/api/public/:table/:id` GET endpoint
- [ ] Update POST to invalidate cache
- [ ] Update PUT to invalidate cache
- [ ] Update DELETE to invalidate cache
- [ ] Update Bulk DELETE to invalidate cache
- [ ] Cache session in login endpoint
- [ ] Add cache management endpoints (/admin/cache/*)
- [ ] Set proper Cache-Control headers
- [ ] Test with curl commands
- [ ] Monitor Redis with `redis-cli`
- [ ] Optional: Set up Varnish with docker-compose.yml
