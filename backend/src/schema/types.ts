// `json` is kept for backward compatibility (older schemas) but is treated as `text`.
export type ColumnType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "image";

export type ColumnDef = {
  name: string;
  type: ColumnType;
  required?: boolean;
};

export type TableDef = {
  name: string;
  columns: ColumnDef[];
};

export type CmsSchema = {
  version: 1;
  tables: TableDef[];
};
