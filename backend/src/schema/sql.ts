import type { ColumnType } from "./types";

export function sqlTypeFor(colType: ColumnType): string {
  switch (colType) {
    case "string":
      return "text";
    case "text":
      return "text";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamptz";
    case "json":
      // Legacy: `json` was previously stored as jsonb but is now migrated to `text`.
      return "text";
    case "image":
      return "text";
  }
}
