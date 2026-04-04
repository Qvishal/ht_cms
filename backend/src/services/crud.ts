import { db } from "../db";
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

type DbRow = Record<string, unknown> & {
  id: string;
  created_by?: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
};

function validateValue(type: ColumnDef["type"], value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case "string":
    case "text":
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

  if (!ctx.includeDeleted) where.push("is_deleted = false");
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

export async function getRow(table: string, id: string, ctx: DataContext) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const params: unknown[] = [id];
  const where: string[] = ["id = $1"];
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

  payload.created_by = ctx.userId;

  const keys = Object.keys(payload);
  const values = Object.values(payload);

  const colList = keys.map(quoteIdent).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  const rows = (await db.unsafe(
    `insert into ${quoteIdent(table)} (${colList}) values (${params}) returning *`,
    values,
  )) as DbRow[];

  const row = rows[0] ?? null;
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
  id: string,
  input: Record<string, unknown>,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const oldRow = await getRow(table, id, { ...ctx, includeDeleted: false });
  if (!oldRow) return null;

  const columns = await getColumns(table);
  const payload = sanitizeInput(columns, input, "update");

  const keys = Object.keys(payload);
  const values = Object.values(payload);
  if (keys.length === 0) return oldRow;

  const sets = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(", ");

  const where: string[] = [`id = $${keys.length + 1}`, "is_deleted = false"];
  const params: unknown[] = [...values, id];
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  const tableInfo = await getTableInfoByName(table);
  if (tableInfo) {
    await createRowVersion({
      tableId: tableInfo.id,
      rowId: id,
      data: oldRow,
      updatedBy: ctx.userId,
    });
  }

  const rows = (await db.unsafe(
    `update ${quoteIdent(table)} set ${sets} where ${where.join(" and ")} returning *`,
    params,
  )) as DbRow[];
  const nextRow = rows[0] ?? null;

  await writeAuditLog({
    userId: ctx.userId,
    actionType: "UPDATE",
    tableId: tableInfo?.id ?? null,
    rowId: id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}

export async function softDeleteRow(
  table: string,
  id: string,
  ctx: DataContext,
) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);

  const oldRow = await getRow(table, id, { ...ctx, includeDeleted: true });
  if (!oldRow || oldRow.is_deleted) return null;

  const where: string[] = ["id = $1", "is_deleted = false"];
  const params: unknown[] = [id];
  if (!ctx.isAdmin && ctx.visibilityMode === "USER_SCOPED") {
    params.push(ctx.userId);
    where.push(`created_by = $${params.length}`);
  }

  const rows = (await db.unsafe(
    `update ${quoteIdent(table)} set is_deleted = true, deleted_at = now() where ${where.join(
      " and ",
    )} returning *`,
    params,
  )) as DbRow[];
  const nextRow = rows[0] ?? null;

  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "DELETE",
    tableId: tableInfo?.id ?? null,
    rowId: id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}

export async function restoreRow(table: string, id: string, ctx: DataContext) {
  const oldRow = await getRow(table, id, { ...ctx, includeDeleted: true });
  if (!oldRow || !oldRow.is_deleted) return null;

  const rows = (await db.unsafe(
    `update ${quoteIdent(table)} set is_deleted = false, deleted_at = null where id = $1 returning *`,
    [id],
  )) as DbRow[];
  const nextRow = rows[0] ?? null;

  const tableInfo = await getTableInfoByName(table);
  await writeAuditLog({
    userId: ctx.userId,
    actionType: "UPDATE",
    tableId: tableInfo?.id ?? null,
    rowId: id,
    oldValue: oldRow,
    newValue: nextRow,
  });

  return nextRow;
}
