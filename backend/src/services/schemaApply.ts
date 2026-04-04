import { readSchema, writeSchema } from "../schema/store";
import type { CmsSchema, TableDef } from "../schema/types";
import {
  addPhysicalColumn,
  ensurePhysicalTable,
  upsertRegistryForSchema,
} from "./registry";

export async function applySchema(nextTables: TableDef[]): Promise<CmsSchema> {
  // Create physical tables first (id/created_at/updated_at included automatically).
  for (const t of nextTables) {
    await ensurePhysicalTable(t);
  }

  // Ensure columns exist and apply safe type upgrades (non-destructive).
  // Note: We intentionally avoid automatic drops/renames.
  for (const t of nextTables) {
    for (const col of t.columns) {
      await addPhysicalColumn(t.name, col);
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
