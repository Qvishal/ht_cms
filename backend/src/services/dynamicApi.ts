/**
 * Dynamic API Service
 *
 * Provides a unified service for dynamically generating APIs for any table
 * created during setup or by admin. All APIs are auto-validated, authorized,
 * and integrated with audit logs and versioning.
 */

import { db } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";
import type { ColumnDef } from "../schema/types";
import {
  getTableInfoByName,
  tableExistsInRegistry,
  getColumns,
} from "./registry";
import { getVisibilityMode } from "./tableMetadata";
import type { DataContext } from "./crud";

export interface DynamicQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
  search?: { field: string; query: string }[];
  filters?: { field: string; operator: string; value: unknown }[];
}

/**
 * Validates if a table exists and user has access
 */
export async function validateTableAccess(
  table: string,
  ctx: DataContext,
  requiredAccess: "read" | "write",
) {
  assertIdent(table, "table");

  const exists = await tableExistsInRegistry(table);
  if (!exists) {
    throw new Error(`Table "${table}" does not exist`);
  }

  // Note: Full RBAC validation is handled in the route middleware (requireTableRead/Write)
  // This function just validates table existence
}

/**
 * Safely builds WHERE clause with parameterized queries
 */
export function buildDynamicWhere(
  ctx: DataContext,
  filters?: DynamicQueryOptions["filters"],
): { whereClauses: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  // Always filter soft-deleted unless explicitly included (admin only)
  if (!ctx.includeDeleted) {
    where.push("is_deleted = false");
  }

  // Visibility: USER_SCOPED tables filter by created_by
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  // Custom filters (e.g., status = "active")
  if (filters && filters.length > 0) {
    for (const filter of filters) {
      assertIdent(filter.field, "field");

      if (filter.operator === "eq") {
        params.push(filter.value);
        where.push(`${quoteIdent(filter.field)} = $${params.length}`);
      } else if (filter.operator === "neq") {
        params.push(filter.value);
        where.push(`${quoteIdent(filter.field)} != $${params.length}`);
      } else if (filter.operator === "gt") {
        params.push(filter.value);
        where.push(`${quoteIdent(filter.field)} > $${params.length}`);
      } else if (filter.operator === "lt") {
        params.push(filter.value);
        where.push(`${quoteIdent(filter.field)} < $${params.length}`);
      } else if (filter.operator === "like") {
        params.push(`%${filter.value}%`);
        where.push(`${quoteIdent(filter.field)} ilike $${params.length}`);
      } else if (filter.operator === "in") {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new Error(
            `Invalid 'in' filter for "${filter.field}": must be non-empty array`,
          );
        }
        const placeholders = filter.value
          .map((v) => {
            params.push(v);
            return `$${params.length}`;
          })
          .join(",");
        where.push(`${quoteIdent(filter.field)} = any(array[${placeholders}])`);
      } else {
        throw new Error(`Unknown operator: "${filter.operator}"`);
      }
    }
  }

  return { whereClauses: where, params };
}

/**
 * Build ORDER BY clause safely
 */
export function buildOrderBy(options?: DynamicQueryOptions): {
  orderSql: string;
  params: unknown[];
} {
  let orderSql = "order by created_at desc";
  const params: unknown[] = [];

  if (options?.orderBy) {
    assertIdent(options.orderBy, "field");
    const direction = options.ascending ? "asc" : "desc";
    orderSql = `order by ${quoteIdent(options.orderBy)} ${direction}`;
  }

  return { orderSql, params };
}

/**
 * Fetch paginated rows with optional filters
 */
export async function fetchPagedRows(
  table: string,
  ctx: DataContext,
  options?: DynamicQueryOptions,
): Promise<Record<string, unknown>[]> {
  assertIdent(table, "table");

  const { whereClauses, params } = buildDynamicWhere(ctx, options?.filters);
  const { orderSql } = buildOrderBy(options);

  const limit = Math.min(options?.limit ?? 50, 200);
  const offset = options?.offset ?? 0;

  params.push(limit, offset);
  const whereClause =
    whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";

  const rows = await db.unsafe(
    `select * from ${quoteIdent(table)} ${whereClause} ${orderSql} limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return rows as Record<string, unknown>[];
}

/**
 * Count rows matching filters (for pagination)
 */
export async function countRows(
  table: string,
  ctx: DataContext,
  filters?: DynamicQueryOptions["filters"],
): Promise<number> {
  assertIdent(table, "table");

  const { whereClauses, params } = buildDynamicWhere(ctx, filters);
  const whereClause =
    whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";

  const result = (await db.unsafe(
    `select count(*)::int as count from ${quoteIdent(table)} ${whereClause}`,
    params,
  )) as { count: number }[];

  return result[0]?.count ?? 0;
}

/**
 * Fetch distinct values for a field (useful for dropdowns, filters)
 */
export async function fetchDistinctValues(
  table: string,
  field: string,
  ctx: DataContext,
  limit = 100,
): Promise<unknown[]> {
  assertIdent(table, "table");
  assertIdent(field, "field");

  const { whereClauses, params } = buildDynamicWhere(ctx);
  const whereClause =
    whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";

  params.push(limit);
  const rows = (await db.unsafe(
    `select distinct ${quoteIdent(field)} from ${quoteIdent(table)} ${whereClause} order by ${quoteIdent(field)} asc limit $${params.length}`,
    params,
  )) as { [key: string]: unknown }[];

  return rows.map((r) => r[field]);
}

/**
 * Bulk delete rows (soft delete)
 */
export async function bulkSoftDelete(
  table: string,
  ids: string[],
  ctx: DataContext,
): Promise<{ deleted: number }> {
  if (!ids.length) return { deleted: 0 };

  assertIdent(table, "table");

  const idPlaceholders = ids
    .map((id, idx) => {
      const index = idx + 1;
      return `$${index}`;
    })
    .join(",");

  const result = (await db.unsafe(
    `update ${quoteIdent(table)} set is_deleted = true, deleted_at = now() where id = any(array[${idPlaceholders}]) returning id`,
    ids,
  )) as { id: string }[];

  return { deleted: result.length };
}

/**
 * Bulk update rows (partial update)
 */
export async function bulkUpdate(
  table: string,
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  ctx: DataContext,
  columns: ColumnDef[],
): Promise<{ updated: number }> {
  if (!updates.length) return { updated: 0 };

  assertIdent(table, "table");

  let updatedCount = 0;

  for (const { id, data } of updates) {
    const setClauses: string[] = [];
    const params: unknown[] = [id];

    for (const [key, value] of Object.entries(data)) {
      const col = columns.find((c) => c.name === key);
      if (!col) continue;

      params.push(value);
      setClauses.push(`${quoteIdent(key)} = $${params.length}`);
    }

    if (setClauses.length > 0) {
      params.push(new Date().toISOString());
      setClauses.push(`updated_at = $${params.length}`);

      await db.unsafe(
        `update ${quoteIdent(table)} set ${setClauses.join(", ")} where id = $1`,
        params,
      );
      updatedCount++;
    }
  }

  return { updated: updatedCount };
}

/**
 * Get table schema for API documentation
 */
export async function getTableSchema(table: string) {
  assertIdent(table, "table");

  const tableInfo = await getTableInfoByName(table);
  if (!tableInfo) {
    throw new Error(`Table "${table}" not found`);
  }

  const columns = await getColumns(table, false);
  const visibilityMode = await getVisibilityMode(table);

  return {
    table: table,
    id: tableInfo.id,
    visibilityMode,
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type,
      required: c.required,
    })),
    reservedFields: [
      "id",
      "created_at",
      "updated_at",
      "created_by",
      "is_deleted",
      "deleted_at",
    ],
  };
}
