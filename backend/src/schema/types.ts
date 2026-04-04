export type ColumnType = "string" | "number" | "boolean" | "date" | "json";

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

