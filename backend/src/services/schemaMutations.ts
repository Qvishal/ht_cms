import { readSchema, writeSchema } from "../schema/store";
import type { CmsSchema, ColumnDef } from "../schema/types";

export async function removeColumnFromSchema(
  tableName: string,
  columnName: string,
): Promise<void> {
  const schema = await readSchema();
  const next = {
    ...schema,
    tables: schema.tables.map((t) => {
      if (t.name !== tableName) return t;
      return {
        ...t,
        columns: t.columns.filter((c) => c.name !== columnName),
      };
    }),
  } satisfies CmsSchema;
  await writeSchema(next);
}

export async function upsertColumnInSchema(
  tableName: string,
  column: ColumnDef,
): Promise<void> {
  const schema = await readSchema();
  const table = schema.tables.find((t) => t.name === tableName);
  if (!table) return;

  const next = {
    ...schema,
    tables: schema.tables.map((t) => {
      if (t.name !== tableName) return t;
      const without = t.columns.filter((c) => c.name !== column.name);
      return {
        ...t,
        columns: [...without, column].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
    }),
  } satisfies CmsSchema;
  await writeSchema(next);
}
