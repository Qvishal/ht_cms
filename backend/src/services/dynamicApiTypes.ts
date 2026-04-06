/**
 * Dynamic API Types
 * 
 * TypeScript interfaces and types for the dynamic API system.
 * Provides type safety and IDE autocompletion for all dynamic API operations.
 */

import type { ColumnDef } from "./types";

// ============================================================================
// QUERY & FILTER TYPES
// ============================================================================

export type FilterOperator = "eq" | "neq" | "gt" | "lt" | "like" | "in";

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface SearchFilter {
  field: string;
  query: string;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
  search?: SearchFilter[];
  filters?: Filter[];
}

export interface PaginationMetadata {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ListRowsResponse {
  rows: Record<string, unknown>[];
  pagination: PaginationMetadata;
}

export interface GetRowResponse {
  row: Record<string, unknown>;
}

export interface CreateRowResponse {
  row: Record<string, unknown>;
}

export interface UpdateRowResponse {
  row: Record<string, unknown>;
}

export interface DeleteRowResponse {
  ok: true;
}

export interface BulkDeleteResponse {
  deleted: number;
}

export interface DistinctValuesResponse {
  field: string;
  values: unknown[];
  count: number;
}

export interface TableSchemaResponse {
  table: string;
  id: string;
  visibilityMode: "GLOBAL_ACCESS" | "USER_SCOPED";
  columns: ColumnInfo[];
  reservedFields: string[];
}

export interface ColumnInfo {
  name: string;
  type: ColumnDef["type"];
  required: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: "TYPE_MISMATCH" | "REQUIRED" | "INVALID_FORMAT" | "UNKNOWN_FIELD";
}

export interface ValidationErrorResponse {
  error: string;
  details: ValidationErrorDetail[];
}

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// BULK OPERATION TYPES
// ============================================================================

export interface BulkDeleteRequest {
  ids: string[];
}

export interface BulkUpdateItem {
  id: string;
  data: Record<string, unknown>;
}

export interface BulkUpdateRequest {
  updates: BulkUpdateItem[];
}

export interface BulkUpdateResponse {
  updated: number;
}

// ============================================================================
// INDEX TYPES
// ============================================================================

export interface IndexSpec {
  name: string;
  columns: string[];
  unique?: boolean;
  condition?: string;
}

// ============================================================================
// CONTEXT TYPES
// ============================================================================

export interface DataContext {
  userId: string;
  isAdmin: boolean;
  visibilityMode: "GLOBAL_ACCESS" | "USER_SCOPED";
  includeDeleted?: boolean;
}

// ============================================================================
// REQUEST/RESPONSE WRAPPERS
// ============================================================================

export interface ApiRequest<T = unknown> {
  body: T;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  statusCode: number;
  body: T;
}

// ============================================================================
// QUERY BUILDER TYPES
// ============================================================================

export interface WhereClause {
  whereClauses: string[];
  params: unknown[];
}

export interface OrderByClause {
  orderSql: string;
  params: unknown[];
}

export interface SelectQuery {
  table: string;
  columns: string[];
  where: WhereClause;
  orderBy?: OrderByClause;
  limit?: number;
  offset?: number;
}

// ============================================================================
// TABLE METADATA TYPES
// ============================================================================

export interface TableMetadata {
  id: string;
  name: string;
  visibilityMode: "GLOBAL_ACCESS" | "USER_SCOPED";
  columns: ColumnMetadata[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnMetadata extends ColumnDef {
  active: boolean;
  createdAt: Date;
}

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

export interface AuditLogEntry {
  id: string;
  userId: string;
  actionType: "CREATE" | "UPDATE" | "DELETE" | "BULK_DELETE" | "STRUCTURE_CHANGE";
  tableId: string | null;
  tableName?: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

// ============================================================================
// VERSION TYPES
// ============================================================================

export interface RowVersion {
  id: string;
  rowId: string;
  tableName: string;
  version: number;
  data: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
}

// ============================================================================
// PERMISSION TYPES
// ============================================================================

export interface TablePermission {
  tableId: string;
  tableName: string;
  userId: string;
  accessType: "read" | "write" | "admin";
}

export type AccessType = "read" | "write" | "admin" | "none";

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Build a query URL with filters and pagination
 */
export function buildQueryUrl(
  baseUrl: string,
  table: string,
  options?: QueryOptions,
): string {
  const url = new URL(`${baseUrl}/data/${table}`);

  if (options?.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options?.offset !== undefined) url.searchParams.set("offset", String(options.offset));
  if (options?.orderBy) url.searchParams.set("orderBy", options.orderBy);
  if (options?.ascending !== undefined) url.searchParams.set("ascending", String(options.ascending));
  if (options?.filters && options.filters.length > 0) {
    url.searchParams.set("filters", JSON.stringify(options.filters));
  }
  if (options?.search && options.search.length > 0) {
    url.searchParams.set("search", JSON.stringify(options.search));
  }

  return url.toString();
}

/**
 * Type-safe filter builder
 */
export class FilterBuilder {
  private filters: Filter[] = [];

  equals(field: string, value: unknown): this {
    this.filters.push({ field, operator: "eq", value });
    return this;
  }

  notEquals(field: string, value: unknown): this {
    this.filters.push({ field, operator: "neq", value });
    return this;
  }

  greaterThan(field: string, value: unknown): this {
    this.filters.push({ field, operator: "gt", value });
    return this;
  }

  lessThan(field: string, value: unknown): this {
    this.filters.push({ field, operator: "lt", value });
    return this;
  }

  like(field: string, query: string): this {
    this.filters.push({ field, operator: "like", value: query });
    return this;
  }

  in(field: string, values: unknown[]): this {
    this.filters.push({ field, operator: "in", value: values });
    return this;
  }

  build(): Filter[] {
    return [...this.filters];
  }

  reset(): this {
    this.filters = [];
    return this;
  }
}
