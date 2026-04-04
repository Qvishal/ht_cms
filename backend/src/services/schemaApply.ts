import type { CmsSchema, TableDef } from "../schema/types";
import { readSchema, writeSchema } from "../schema/store";
import { addPhysicalColumn, ensurePhysicalTable, getColumns, tableExistsInRegistry, upsertRegistryForSchema } from "./registry";

export async function applySchema(nextTables: TableDef[]): Promise<CmsSchema> {
  // Create physical tables first (id/created_at/updated_at included automatically).
  for (const t of nextTables) {
    await ensurePhysicalTable(t);
  }

  // Add missing columns (non-destructive).
  for (const t of nextTables) {
    const exists = await tableExistsInRegistry(t.name);
    if (!exists) {
      // New table: columns already included in CREATE TABLE
      continue;
    }
    const existing = await getColumns(t.name);
    const existingNames = new Set(existing.map((c) => c.name));
    for (const col of t.columns) {
      if (!existingNames.has(col.name)) {
        await addPhysicalColumn(t.name, col);
      }
    }
  }

  await upsertRegistryForSchema(nextTables);

  const schema: CmsSchema = { version: 1, tables: nextTables };
  await writeSchema(schema);
  return schema;
}

export async function currentSchema(): Promise<CmsSchema> {
  return readSchema();
}

