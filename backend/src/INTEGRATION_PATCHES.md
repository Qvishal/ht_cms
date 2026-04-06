/**
 * INTEGRATION PATCH: backend/src/services/registry.ts
 * 
 * Add automatic index creation for new tables.
 * 
 * Location: In the ensurePhysicalTable() function, after the table is created
 */

// ADD THIS IMPORT at the top of registry.ts:
// import { ensureTableIndexes } from "./dynamicIndexing";

// THEN UPDATE ensurePhysicalTable() function to call indexing:

/**
 * UPDATE DIFF for registry.ts:
 * 
 * OLD CODE (in ensurePhysicalTable function, after creating table):
 *   await db.unsafe(`...create table...`);
 * 
 * NEW CODE:
 *   await db.unsafe(`...create table...`);
 *   
 *   // NEW: Auto-create optimal indexes for performance
 *   try {
 *     await ensureTableIndexes(table.name);
 *   } catch (e) {
 *     console.warn(`Failed to create indexes for table ${table.name}:`, e);
 *     // Don't fail table creation if indexing fails; DB will work, just slower
 *   }
 */

export const REGISTRY_PATCH = `
Add after line ~120 in ensurePhysicalTable(), following the table creation:

  await db.unsafe(\`...\`);
  
  // Auto-create indexes
  try {
    await ensureTableIndexes(table.name);
  } catch (e) {
    console.warn(\`Failed to create indexes for table \${table.name}:\`, e);
  }
`;

/**
 * INTEGRATION PATCH: backend/src/index.ts
 * 
 * Add new routes to expose advanced API features and update existing routes
 * to use the new validation middleware.
 * 
 * Location: Before app.listen()
 */

export const INDEX_TS_ADDITIONS = `
// ADD THESE IMPORTS at the top:
import {
  validateTableAccess,
  fetchPagedRows,
  countRows,
  fetchDistinctValues,
  bulkSoftDelete,
  getTableSchema,
  type DynamicQueryOptions,
} from "./services/dynamicApi";
import {
  validateRequestBody,
  sanitizeInput,
  formatValidationErrors,
} from "./services/dynamicValidation";

// THEN ADD THESE ROUTES before app.listen() or editor at end of route definitions:

// ============================================================================
// ENHANCED DATA ROUTES (replace existing /data/:table routes)
// ============================================================================

.get("/data/:table", async ({ params, query, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableRead(authUser, params.table);
  
  const visibilityMode = await getVisibilityMode(params.table);
  const ctx = {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode,
    includeDeleted: authUser.role === "admin" && String(query.includeDeleted ?? "") === "1",
  };

  // Parse filters if provided
  let filters: DynamicQueryOptions["filters"] = [];
  if (query.filters) {
    try {
      filters = typeof query.filters === "string" ? JSON.parse(query.filters) : query.filters;
      if (!Array.isArray(filters)) filters = [filters];
    } catch {
      set.status = 400;
      return { error: "Invalid filters JSON" };
    }
  }

  const limit = Math.min(Math.max(parseInt(String(query.limit ?? "50")), 1), 200);
  const offset = Math.max(parseInt(String(query.offset ?? "0")), 0);
  
  const options: DynamicQueryOptions = {
    limit,
    offset,
    orderBy: String(query.orderBy ?? "created_at"),
    ascending: String(query.ascending ?? "").toLowerCase() === "true",
    filters,
  };

  const rows = await fetchPagedRows(params.table, ctx, options);
  const total = await countRows(params.table, ctx, filters);

  return {
    rows,
    pagination: { limit, offset, total, hasMore: offset + limit < total },
  };
})

.post("/data/:table", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableWrite(authUser, params.table);

  const columns = await getColumns(params.table);
  
  // Validate request body against schema
  const errors = validateRequestBody(body || {}, columns, "create");
  if (errors.length > 0) {
    set.status = 400;
    return formatValidationErrors(errors);
  }

  const sanitized = sanitizeInput(body || {}, columns);
  const visibilityMode = await getVisibilityMode(params.table);

  const row = await createRow(params.table, sanitized, {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode,
  });

  return { row };
})

.put("/data/:table/:id", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableWrite(authUser, params.table);

  const columns = await getColumns(params.table);
  
  // Validate (update mode allows partial data)
  const errors = validateRequestBody(body || {}, columns, "update");
  if (errors.length > 0) {
    set.status = 400;
    return formatValidationErrors(errors);
  }

  const sanitized = sanitizeInput(body || {}, columns);
  const visibilityMode = await getVisibilityMode(params.table);

  const row = await updateRow(params.table, params.id, sanitized, {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode,
  });

  if (!row) {
    set.status = 404;
    return { error: "Not found" };
  }
  return { row };
})

// ============================================================================
// NEW ROUTES - ADVANCED FEATURES
// ============================================================================

// Get distinct values for a field (for filters/dropdowns)
.get("/data/:table/distinct/:field", async ({ params, query, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableRead(authUser, params.table);

  const visibilityMode = await getVisibilityMode(params.table);
  const ctx = {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode,
    includeDeleted: false,
  };

  const limit = Math.min(parseInt(String(query.limit ?? "100")), 500);
  const values = await fetchDistinctValues(params.table, params.field, ctx, limit);

  return { field: params.field, values, count: values.length };
})

// Bulk soft delete
.post("/data/:table/bulk-delete", async ({ params, body, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableWrite(authUser, params.table);

  const ids = (body as { ids?: unknown }).ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    set.status = 400;
    return { error: "ids must be a non-empty array" };
  }

  const visibilityMode = await getVisibilityMode(params.table);
  const result = await bulkSoftDelete(params.table, ids as string[], {
    userId: authUser.id,
    isAdmin: authUser.role === "admin",
    visibilityMode,
  });

  return result;
})

// Get table schema (for API documentation)
.get("/tables/:table/schema", async ({ params, authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  await requireTableRead(authUser, params.table);

  try {
    const schema = await getTableSchema(params.table);
    return { schema };
  } catch (e) {
    set.status = 404;
    return { error: (e as Error).message };
  }
})

// List all table schemas (all tables user has access to)
.get("/tables/schemas", async ({ authUser, set }) => {
  if (!authUser) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  const tables =
    authUser.role === "admin"
      ? await getTables()
      : await listTablesForUser(authUser.id);

  const schemas = await Promise.all(tables.map((t) => getTableSchema(t)));
  return { schemas };
})
`;
