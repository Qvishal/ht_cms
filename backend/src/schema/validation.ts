import { z } from "zod";
import { assertIdent } from "../lib/ids";

export const ColumnTypeEnum = z.enum(["string", "number", "boolean", "date", "json"]);

export const ColumnDefSchema = z
  .object({
    name: z.string().min(1),
    type: ColumnTypeEnum,
    required: z.boolean().optional()
  })
  .superRefine((col, ctx) => {
    try {
      assertIdent(col.name, "column");
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    }
    const reserved = new Set(["id", "created_at", "updated_at"]);
    if (reserved.has(col.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Column "${col.name}" is reserved`
      });
    }
  });

export const TableDefSchema = z
  .object({
    name: z.string().min(1),
    columns: z.array(ColumnDefSchema).default([])
  })
  .superRefine((table, ctx) => {
    try {
      assertIdent(table.name, "table");
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    }
    const seen = new Set<string>();
    for (const col of table.columns) {
      if (seen.has(col.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate column "${col.name}" in table "${table.name}"`
        });
      }
      seen.add(col.name);
    }
  });

export const ApplySchemaSchema = z
  .object({
    version: z.literal(1).optional(),
    tables: z.array(TableDefSchema)
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const t of body.tables) {
      if (seen.has(t.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate table "${t.name}"`
        });
      }
      seen.add(t.name);
    }
  });

