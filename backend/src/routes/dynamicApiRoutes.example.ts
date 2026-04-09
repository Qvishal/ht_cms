/**
 * DYNAMIC API ROUTES - EXAMPLE INTEGRATION
 *
 * This file shows how to integrate the dynamic API services into your Elysia app.
 * Copy these patterns into your main index.ts file.
 *
 * Location: backend/src/index.ts
 *
 * These routes REPLACE the existing `/data/:table` routes with enhanced versions
 * that use the new dynamic services for validation, filtering, and optimization.
 */

// ============================================================================
// IMPORTS (add to your existing imports in index.ts)
// ============================================================================

import {
  validateTableAccess,
  fetchPagedRows,
  countRows,
  fetchDistinctValues,
  bulkSoftDelete,
  getTableSchema,
  type DynamicQueryOptions,
} from "./services/dynamicApi";
import { ensureTableIndexes } from "./services/dynamicIndexing";
import {
  validateRequestBody,
  sanitizeInput,
  formatValidationErrors,
} from "./services/dynamicValidation";

// ============================================================================
// UPDATED ROUTES
// ============================================================================

/**
 * LIST ROWS WITH ADVANCED FILTERING
 *
 * GET /data/:table?limit=50&offset=0&orderBy=created_at&filters=[...]
 *
 * Replaces the simple listRows() call with advanced filtering support.
 */
export function listRowsRouteHandler() {
  return async ({ params, query, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      await requireTableRead(authUser, table);
      await validateTableAccess(
        table,
        {
          userId: authUser.id,
          isAdmin: authUser.role === "admin",
          visibilityMode: "GLOBAL_ACCESS",
        },
        "read",
      );

      const visibilityMode = await getVisibilityMode(table);
      const ctx = {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
        includeDeleted:
          authUser.role === "admin" &&
          String(query.includeDeleted ?? "") === "1",
      };

      // Parse query options
      const limit = Math.min(Math.max(parseInt(query.limit ?? "50"), 1), 200);
      const offset = Math.max(parseInt(query.offset ?? "0"), 0);
      const orderBy = query.orderBy ?? "created_at";
      const ascending = String(query.ascending ?? "").toLowerCase() === "true";

      // Parse filters if provided
      let filters: DynamicQueryOptions["filters"] = [];
      if (query.filters) {
        try {
          filters =
            typeof query.filters === "string"
              ? JSON.parse(query.filters)
              : query.filters;
          if (!Array.isArray(filters)) filters = [filters];
        } catch {
          set.status = 400;
          return { error: "Invalid filters JSON" };
        }
      }

      const options: DynamicQueryOptions = {
        limit,
        offset,
        orderBy,
        ascending,
        filters,
      };

      const rows = await fetchPagedRows(table, ctx, options);
      const total = await countRows(table, ctx, filters);

      return {
        rows,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
        },
      };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

/**
 * CREATE ROW WITH VALIDATION
 *
 * POST /data/:table
 *
 * Replaces the simple createRow() with schema validation using dynamicValidation service.
 */
export function createRowRouteHandler() {
  return async ({ params, body, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      await requireTableWrite(authUser, table);

      const visibilityMode = await getVisibilityMode(table);
      const columns = await getColumns(table);

      // VALIDATE REQUEST BODY
      const validationErrors = validateRequestBody(
        body || {},
        columns,
        "create",
      );
      if (validationErrors.length > 0) {
        set.status = 400;
        return formatValidationErrors(validationErrors);
      }

      // SANITIZE INPUT (remove unknown and reserved fields)
      const sanitized = sanitizeInput(body || {}, columns);

      const ctx = {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
      };

      const row = await createRow(table, sanitized, ctx);

      // LOG TO AUDIT
      await writeAuditLog({
        userId: authUser.id,
        actionType: "CREATE",
        tableId: (await getTableInfoByName(table))?.id ?? null,
        oldValue: null,
        newValue: row,
      });

      return { row };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

/**
 * UPDATE ROW WITH VALIDATION
 *
 * PUT /data/:table/:id
 *
 * Uses schema validation for partial updates.
 */
export function updateRowRouteHandler() {
  return async ({ params, body, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      const id = params.id;

      await requireTableWrite(authUser, table);

      const visibilityMode = await getVisibilityMode(table);
      const columns = await getColumns(table);

      // VALIDATE REQUEST BODY (for update, only validate fields being changed)
      const validationErrors = validateRequestBody(
        body || {},
        columns,
        "update",
      );
      if (validationErrors.length > 0) {
        set.status = 400;
        return formatValidationErrors(validationErrors);
      }

      // SANITIZE INPUT
      const sanitized = sanitizeInput(body || {}, columns);

      const ctx = {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
      };

      // GET CURRENT ROW FOR AUDIT
      const oldRow = await getRow(table, id, ctx);
      if (!oldRow) {
        set.status = 404;
        return { error: "Row not found" };
      }

      const row = await updateRow(table, id, sanitized, ctx);

      // LOG TO AUDIT
      await writeAuditLog({
        userId: authUser.id,
        actionType: "UPDATE",
        tableId: (await getTableInfoByName(table))?.id ?? null,
        oldValue: oldRow,
        newValue: row,
      });

      return { row };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

// ============================================================================
// NEW ROUTES - ADVANCED FEATURES
// ============================================================================

/**
 * GET DISTINCT VALUES (for dropdowns, filters)
 *
 * GET /data/:table/distinct/:field
 *
 * Returns a list of distinct values for a field, useful for building filter UIs.
 */
export function distinctValuesRouteHandler() {
  return async ({ params, query, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      const field = params.field;

      await requireTableRead(authUser, table);

      const visibilityMode = await getVisibilityMode(table);
      const ctx = {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
        includeDeleted: false,
      };

      const limit = Math.min(parseInt(query.limit ?? "100"), 500);
      const values = await fetchDistinctValues(table, field, ctx, limit);

      return { field, values, count: values.length };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

/**
 * BULK DELETE ROWS (soft delete)
 *
 * POST /data/:table/bulk-delete
 * {
 *   "ids": ["id1", "id2", "id3"]
 * }
 *
 * Efficiently soft-delete multiple rows.
 */
export function bulkDeleteRouteHandler() {
  return async ({ params, body, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      await requireTableWrite(authUser, table);

      const ids = body.ids || [];
      if (!Array.isArray(ids) || ids.length === 0) {
        set.status = 400;
        return { error: "ids must be a non-empty array" };
      }

      const visibilityMode = await getVisibilityMode(table);
      const ctx = {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
      };

      const result = await bulkSoftDelete(table, ids, ctx);

      // LOG TO AUDIT
      await writeAuditLog({
        userId: authUser.id,
        actionType: "BULK_DELETE",
        tableId: (await getTableInfoByName(table))?.id ?? null,
        oldValue: { ids },
        newValue: null,
      });

      return result;
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

/**
 * GET TABLE SCHEMA (API documentation)
 *
 * GET /tables/:table/schema
 *
 * Returns the table schema, columns, and data types for frontend API builders.
 */
export function getTableSchemaRouteHandler() {
  return async ({ params, authUser, set }: any) => {
    try {
      if (!authUser) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const table = params.table;
      await requireTableRead(authUser, table);

      const schema = await getTableSchema(table);
      return { schema };
    } catch (error) {
      set.status = 404;
      return { error: (error as Error).message };
    }
  };
}

/**
 * LIST ALL TABLE SCHEMAS (for API explorer)
 *
 * GET /tables/schemas
 *
 * Returns schemas for all tables the user has access to.
 */
export function listTableSchemasRouteHandler() {
  return async ({ authUser, set }: any) => {
    try {
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
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  };
}

// ============================================================================
// UPDATE REGISTRY TO AUTO-INDEX TABLES
// ============================================================================

/**
 * Add this to registry.ts ensurePhysicalTable() function, after creating the table:
 *
 *   await ensureTableIndexes(table.name);
 *
 * This ensures all new tables automatically get optimized indexes.
 */
export const AUTO_INDEXING_CODE = `
// In src/services/registry.ts, update ensurePhysicalTable():

export async function ensurePhysicalTable(table: TableDef): Promise<void> {
  // ... existing code to create table ...
  
  // NEW: automatically create indexes for performance
  await ensureTableIndexes(table.name);
}
`;

// ============================================================================
// INTEGRATION SUMMARY
// ============================================================================

/**
 * To integrate these routes into your Elysia app:
 *
 * 1. Import the new services:
 *    - dynamicApi.ts
 *    - dynamicValidation.ts
 *    - dynamicIndexing.ts
 *
 * 2. Replace existing data routes with the new handlers:
 *    .get("/data/:table", listRowsRouteHandler())
 *    .post("/data/:table", createRowRouteHandler())
 *    .put("/data/:table/:id", updateRowRouteHandler())
 *
 * 3. Add new routes:
 *    .get("/data/:table/distinct/:field", distinctValuesRouteHandler())
 *    .post("/data/:table/bulk-delete", bulkDeleteRouteHandler())
 *    .get("/tables/:table/schema", getTableSchemaRouteHandler())
 *    .get("/tables/schemas", listTableSchemasRouteHandler())
 *
 * 4. Update registry.ts to auto-index tables
 *
 * All existing features (RBAC, soft delete, audit logs, versioning) continue to work
 * without modification. The new services enhance them with validation, filtering,
 * and performance optimization.
 */
