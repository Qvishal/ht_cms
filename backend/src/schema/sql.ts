import type { ColumnType } from "./types";

export function sqlTypeFor(colType: ColumnType): string {
  switch (colType) {
    case "string":
      return "text";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamptz";
    case "json":
      return "jsonb";
  }
}

