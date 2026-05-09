import type { ColumnType } from "./types";

export function sqlTypeFor(colType: ColumnType): string {
  const dialect = process.env.DB_DIALECT === "mysql" ? "mysql" : "postgres";
  switch (colType) {
    case "string":
      return dialect === "mysql" ? "text" : "text";
    case "text":
      // MySQL: prefer LONGTEXT for rich text / long descriptions.
      return dialect === "mysql" ? "longtext" : "text";
    case "number":
      return dialect === "mysql" ? "double" : "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return dialect === "mysql" ? "datetime" : "timestamptz";
    case "json":
      // Legacy: `json` was previously stored as jsonb but is now migrated to `text`.
      return dialect === "mysql" ? "longtext" : "text";
    case "image":
      return dialect === "mysql" ? "text" : "text";
  }
}
