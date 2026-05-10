import { db, dbDialect } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";
import type { ColumnDef } from "../schema/types";
import { writeAuditLog } from "./audit";
import {
  getColumns,
  getTableInfoByName,
  tableExistsInRegistry,
} from "./registry";
import type { VisibilityMode } from "./tableMetadata";
import { createRowVersion } from "./versions";
import { newId } from "../lib/uuid";

type DbRow = Record<string, unknown> & {
  id: string;
  s_no?: number;
  created_by?: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
};

function rowKeyWhere(rowKey: string): { where: string; value: unknown } {
  const asNum = Number(rowKey);
  if (Number.isInteger(asNum) && asNum > 0 && String(rowKey).trim() === String(asNum)) {
    return { where: "s_no = $1", value: asNum };
  }
  return { where: "id = $1", value: rowKey };
}

function validateValue(type: ColumnDef["type"], value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case "string":
    case "text":
    case "image": // stored as text (URL or upload path)
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "json":
      // Legacy: callers should send a string; DB stores text.
      return typeof value === "string";
    default:
      return false;
  }
}

function sanitizeInput(
  columns: ColumnDef[],
  input: Record<string, unknown>,
  mode: "create" | "update",
): Record<string, unknown> {
  const allowed = new Map(columns.map((c) => [c.name, c]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const col = allowed.get(key);
    if (!col) continue;
    if (!validateValue(col.type, value)) {
      throw new Error(`Invalid value for "${key}" (${col.type})`);
    }
    if (
      mode === "update" &&
      col.required &&
      (value === null || value === undefined)
    ) {
      throw new Error(`Field "${key}" cannot be null`);
    }
    out[key] = value;
  }

  if (mode === "create") {
    for (const col of columns) {
      if (
        col.required &&
        (out[col.name] === undefined || out[col.name] === null)
      ) {
        throw new Error(`Missing required field "${col.name}"`);
      }
    }
  }

  return out;
}

export type DataContext = {
  userId: string;
  isAdmin: boolean;
  visibilityMode: VisibilityMode;
  includeDeleted?: boolean;
};

function buildWhere(ctx: DataContext): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  // MySQL stores booleans as TINYINT(1) — use 0/1 literals for MySQL, false/true for Postgres
  const isDeletedFalse = dbDialect === "mysql" ? "is_deleted = 0" : "is_deleted = false";
  const isDeletedTrue  = dbDialect === "mysql" ? "is_deleted = 1" : "is_deleted = true";

  // "Show deleted" → show ONLY deleted rows; otherwise show only active rows
  where.push(ctx.includeDeleted ? isDeletedTrue : isDeletedFalse);

  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  return {
    whereSql: where.length ? `where ${where.join(" and ")}` : "",
    params,
  };
}


export async function listRows(
  table: string,
  limit: number,
  offset: number,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const { whereSql, params } = buildWhere(ctx);
  const rows = await db.unsafe(
    `select * from ${quoteIdent(table)} ${whereSql} order by created_at desc limit $${
      params.length + 1
    } offset $${params.length + 2}`,
    [...params, Number(limit), Number(offset)],
  );
  return rows as DbRow[];
}

export async function getRow(table: string, rowKey: string, ctx: DataContext) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const base = rowKeyWhere(rowKey);
  const params: unknown[] = [base.value];
  const where: string[] = [base.where];
  if (!ctx.includeDeleted) where.push("is_deleted = false");
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  const rows = (await db.unsafe(
    `select * from ${quoteIdent(table)} where ${where.join(" and ")} limit 1`,
    params,
  )) as DbRow[];
  return rows[0] ?? null;
}

export async function createRow(
  table: string,
  input: Record<string, unknown>,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const columns = await getColumns(table);
  const payload = sanitizeInput(columns, input, "create");

  payload.id = newId();
  payload.created_by = ctx.userId;

  const keys = Object.keys(payload);
  const values = Object.values(payload);

  const colList = keys.map(quoteIdent).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  if (dbDialect === "mysql") {
    await db.unsafe(
      `insert into ${quoteIdent(table)} (${colList}) values (${params})`,
      values,
    );
  } else {
    await db.unsafe(
      `insert into ${quoteIdent(table)} (${colList}) values (${params})`,
      values,
    );
  }

  const row = await getRow(table, String(payload.id), {
    ...ctx,
    includeDeleted: true,
  });
  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "CREATE",
    tableId: tableInfo?.id ?? null,
    rowId: row?.id ?? null,
    oldValue: null,
    newValue: row,
  });

  return row;
}

export async function updateRow(
  table: string,
  rowKey: string,
  input: Record<string, unknown>,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const oldRow = await getRow(table, rowKey, { ...ctx, includeDeleted: false });
  if (!oldRow) return null;

  const columns = await getColumns(table);
  const payload = sanitizeInput(columns, input, "update");

  const keys = Object.keys(payload);
  const values = Object.values(payload);
  if (keys.length === 0) return oldRow;

  const sets = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(", ");

  const base = rowKeyWhere(rowKey);
  const where: string[] = [
    `${base.where.replace("$1", `$${keys.length + 1}`)}`,
    "is_deleted = false",
  ];
  const params: unknown[] = [...values, base.value];
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  const tableInfo = await getTableInfoByName(table);
  if (tableInfo) {
    await createRowVersion({
      tableId: tableInfo.id,
      rowId: oldRow.id,
      data: oldRow,
      updatedBy: ctx.userId,
    });
  }

  await db.unsafe(
    `update ${quoteIdent(table)} set ${sets} where ${where.join(" and ")}`,
    params,
  );
  const nextRow = await getRow(table, rowKey, { ...ctx, includeDeleted: false });

  await writeAuditLog({
    userId: ctx.userId,
    actionType: "UPDATE",
    tableId: tableInfo?.id ?? null,
    rowId: oldRow.id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}

export async function softDeleteRow(
  table: string,
  rowKey: string,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const oldRow = await getRow(table, rowKey, { ...ctx, includeDeleted: true });
  // MySQL returns is_deleted as 0/1 (integer), Postgres returns true/false
  if (!oldRow || Number(oldRow.is_deleted)) return null;

  const base = rowKeyWhere(rowKey);
  const where: string[] = [base.where, dbDialect === "mysql" ? "is_deleted = 0" : "is_deleted = false"];
  const params: unknown[] = [base.value];
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  const deletedAtSql = dbDialect === "mysql" ? "current_timestamp" : "now()";
  await db.unsafe(
    `update ${quoteIdent(table)} set is_deleted = true, deleted_at = ${deletedAtSql} where ${where.join(
      " and ",
    )}`,
    params,
  );
  const nextRow = await getRow(table, rowKey, { ...ctx, includeDeleted: true });

  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "DELETE",
    tableId: tableInfo?.id ?? null,
    rowId: oldRow.id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}

export async function hardDeleteRow(
  table: string,
  rowKey: string,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const oldRow = await getRow(table, rowKey, { ...ctx, includeDeleted: true });
  if (!oldRow) return null;

  const base = rowKeyWhere(rowKey);
  const where: string[] = [base.where];
  const params: unknown[] = [base.value];
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  await db.unsafe(
    `delete from ${quoteIdent(table)} where ${where.join(" and ")}`,
    params,
  );
  const still = await getRow(table, rowKey, { ...ctx, includeDeleted: true });
  if (still) return null;

  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "DELETE",
    tableId: tableInfo?.id ?? null,
    rowId: oldRow.id,
    oldValue: oldRow,
    newValue: null,
  });

  return oldRow;
}

export async function restoreRow(
  table: string,
  rowKey: string,
  ctx: DataContext,
) {
  const oldRow = await getRow(table, rowKey, { ...ctx, includeDeleted: true });
  // MySQL returns is_deleted as 0/1 (integer), Postgres returns true/false
  if (!oldRow || !Number(oldRow.is_deleted)) return null;

  // Use dialect-safe boolean literal for is_deleted
  const falseVal = dbDialect === "mysql" ? "0" : "false";
  await db.unsafe(
    `update ${quoteIdent(table)} set is_deleted = ${falseVal}, deleted_at = null where s_no = $1`,
    [oldRow.s_no],
  );
  const nextRow = await getRow(table, rowKey, { ...ctx, includeDeleted: true });

  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "UPDATE",
    tableId: tableInfo?.id ?? null,
    rowId: oldRow.id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}
