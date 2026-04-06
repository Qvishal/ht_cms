/**
 * Dynamic Validation Middleware
 * 
 * Provides schema-driven validation for all dynamic API requests.
 * Validates request body against column definitions before CRUD operations.
 */

import type { ColumnDef } from "../schema/types";

export interface ValidationError {
  field: string;
  message: string;
  code: "TYPE_MISMATCH" | "REQUIRED" | "INVALID_FORMAT" | "UNKNOWN_FIELD";
}

/**
 * Validate a single value against a column type
 */
export function validateColumnValue(
  type: ColumnDef["type"],
  value: unknown,
  options: { required?: boolean; field?: string } = {},
): ValidationError | null {
  const { required = false, field = "field" } = options;

  // Null/undefined handling
  if (value === null || value === undefined) {
    if (required) {
      return {
        field,
        code: "REQUIRED",
        message: `"${field}" is required`,
      };
    }
    return null; // Null is valid for optional fields
  }

  switch (type) {
    case "string":
      if (typeof value !== "string") {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be a string`,
        };
      }
      if (value.length === 0) {
        return {
          field,
          code: "INVALID_FORMAT",
          message: `"${field}" cannot be empty`,
        };
      }
      return null;

    case "text":
      if (typeof value !== "string") {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be a string`,
        };
      }
      return null;

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be a valid number`,
        };
      }
      return null;

    case "boolean":
      if (typeof value !== "boolean") {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be a boolean`,
        };
      }
      return null;

    case "date":
      if (typeof value !== "string") {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be an ISO date string`,
        };
      }
      if (Number.isNaN(Date.parse(value))) {
        return {
          field,
          code: "INVALID_FORMAT",
          message: `"${field}" is not a valid date (ISO 8601 required)`,
        };
      }
      return null;

    case "json":
      if (typeof value !== "string") {
        return {
          field,
          code: "TYPE_MISMATCH",
          message: `"${field}" must be a JSON string`,
        };
      }
      try {
        JSON.parse(value);
      } catch {
        return {
          field,
          code: "INVALID_FORMAT",
          message: `"${field}" is not valid JSON`,
        };
      }
      return null;

    default:
      return {
        field,
        code: "TYPE_MISMATCH",
        message: `Unknown type: "${type}"`,
      };
  }
}

/**
 * Validate an entire request body against column definitions
 */
export function validateRequestBody(
  input: Record<string, unknown>,
  columns: ColumnDef[],
  mode: "create" | "update" = "create",
): ValidationError[] {
  const errors: ValidationError[] = [];
  const allowedFields = new Set(columns.map((c) => c.name));

  // Check for unknown fields
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      // Warn but don't error; extra fields are simply ignored
      console.debug(`Ignoring unknown field: "${key}"`);
    }
  }

  // Validate each column
  for (const col of columns) {
    const value = input[col.name];

    // In create mode, all required fields must be present
    if (mode === "create" && col.required && (value === undefined || value === null)) {
      errors.push({
        field: col.name,
        code: "REQUIRED",
        message: `"${col.name}" is required`,
      });
      continue;
    }

    // In update mode, only validate fields that are being updated
    if (mode === "update" && value === undefined) {
      continue; // Skip validation for missing fields in update
    }

    // Validate type
    const typeError = validateColumnValue(col.type, value, {
      required: mode === "create" && col.required,
      field: col.name,
    });

    if (typeError) {
      errors.push(typeError);
    }
  }

  return errors;
}

/**
 * Sanitize input by removing unknown fields and system fields
 */
export function sanitizeInput(
  input: Record<string, unknown>,
  columns: ColumnDef[],
): Record<string, unknown> {
  const allowed = new Set(columns.map((c) => c.name));
  const reserved = new Set(["id", "created_at", "updated_at", "created_by", "is_deleted", "deleted_at"]);
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (reserved.has(key)) {
      console.debug(`Ignoring reserved system field: "${key}"`);
      continue;
    }
    if (allowed.has(key)) {
      output[key] = value;
    }
  }

  return output;
}

/**
 * Format validation errors for API response
 */
export function formatValidationErrors(errors: ValidationError[]): {
  error: string;
  details: ValidationError[];
} {
  return {
    error: `Validation failed: ${errors.length} error(s)`,
    details: errors,
  };
}
