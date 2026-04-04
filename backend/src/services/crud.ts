import { db } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";
import type { ColumnDef } from "../schema/types";
import { getColumns, tableExistsInRegistry } from "./registry";

function validateValue(type: ColumnDef["type"], value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "json":
      return true;
  }
}

function sanitizeInput(
  columns: ColumnDef[],
  input: Record<string, unknown>,
  mode: "create" | "update"
): Record<string, unknown> {
  const allowed = new Map(columns.map((c) => [c.name, c]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const col = allowed.get(key);
    if (!col) continue;
    if (!validateValue(col.type, value)) {
      throw new Error(`Invalid value for "${key}" (${col.type})`);
    }
    if (mode === "update" && col.required && (value === null || value === undefined)) {
      throw new Error(`Field "${key}" cannot be null`);
    }
    out[key] = value;
  }

  if (mode === "create") {
    for (const col of columns) {
      if (col.required && (out[col.name] === undefined || out[col.name] === null)) {
        throw new Error(`Missing required field "${col.name}"`);
      }
    }
  }

  return out;
}

export async function listRows(table: string, limit: number, offset: number) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const rows = await db.unsafe(
    `select * from ${quoteIdent(table)} order by created_at desc limit ${Number(limit)} offset ${Number(
      offset
    )}`
  );
  return rows;
}

export async function getRow(table: string, id: string) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const rows = await db.unsafe(`select * from ${quoteIdent(table)} where id = $1 limit 1`, [id]);
  return rows[0] ?? null;
}

export async function createRow(table: string, input: Record<string, unknown>) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const columns = await getColumns(table);
  const payload = sanitizeInput(columns, input, "create");

  const keys = Object.keys(payload);
  const values = Object.values(payload);

  if (keys.length === 0) {
    const rows = await db.unsafe(`insert into ${quoteIdent(table)} default values returning *`);
    return rows[0];
  }

  const colList = keys.map(quoteIdent).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.unsafe(
    `insert into ${quoteIdent(table)} (${colList}) values (${params}) returning *`,
    values
  );
  return rows[0];
}

export async function updateRow(table: string, id: string, input: Record<string, unknown>) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const columns = await getColumns(table);
  const payload = sanitizeInput(columns, input, "update");

  const keys = Object.keys(payload);
  const values = Object.values(payload);
  if (keys.length === 0) return await getRow(table, id);

  const sets = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(", ");
  const rows = await db.unsafe(
    `update ${quoteIdent(table)} set ${sets} where id = $${keys.length + 1} returning *`,
    [...values, id]
  );
  return rows[0] ?? null;
}

export async function deleteRow(table: string, id: string) {
  assertIdent(table, "table");
  const ok = await tableExistsInRegistry(table);
  if (!ok) throw new Error(`Unknown table "${table}"`);
  const rows = await db.unsafe(`delete from ${quoteIdent(table)} where id = $1 returning *`, [id]);
  return rows[0] ?? null;
}
