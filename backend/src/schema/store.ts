import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { CmsSchema } from "./types";

const SchemaFile = z.object({
  version: z.literal(1),
  tables: z
    .array(
      z.object({
        name: z.string(),
        columns: z.array(
          z.object({
            name: z.string(),
            // `json` is legacy and will be normalized to `text` on read.
            type: z.enum([
              "string",
              "text",
              "number",
              "boolean",
              "date",
              "json",
            ]),
            required: z.boolean().optional(),
          }),
        ),
      }),
    )
    .default([]),
});

export function schemaPath(): string {
  // backend/src -> repo root -> schema/schema.json
  return path.resolve(import.meta.dir, "../../schema/schema.json");
}

export async function readSchema(): Promise<CmsSchema> {
  const filePath = schemaPath();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = SchemaFile.safeParse(JSON.parse(raw));
    if (!parsed.success) throw parsed.error;
    // Normalize legacy `json` → `text` so newer UI/validators stay consistent.
    const normalized = {
      ...parsed.data,
      tables: parsed.data.tables.map((t) => ({
        ...t,
        columns: t.columns.map((c) => ({
          ...c,
          type: c.type === "json" ? "text" : c.type,
        })),
      })),
    };
    return normalized as CmsSchema;
  } catch (err) {
    // If missing or invalid, start empty.
    return { version: 1, tables: [] };
  }
}

export async function writeSchema(schema: CmsSchema): Promise<void> {
  const filePath = schemaPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}
