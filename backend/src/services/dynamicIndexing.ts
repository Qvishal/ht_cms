/**
 * Dynamic Indexing Service
 *
 * Automatically creates optimal indexes for new tables:
 * - Primary key (id) - added by default
 * - created_by - for USER_SCOPED visibility filtering
 * - is_deleted + created_at - for soft delete + sorting query optimization
 * - created_at - for default ordering
 *
 * These indexes ensure optimal performance for common query patterns.
 */

import { db } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";

export interface IndexSpec {
  name: string;
  columns: string[];
  unique?: boolean;
  condition?: string; // partial index condition
}

/**
 * Default indexes that should be created for every table
 */
export function getDefaultIndexes(tableName: string): IndexSpec[] {
  assertIdent(tableName, "table");

  return [
    {
      name: `idx_${tableName}_created_by`,
      columns: ["created_by"],
      condition: "where created_by is not null",
    },
    {
      name: `idx_${tableName}_is_deleted_created_at`,
      columns: ["is_deleted", "created_at"],
      condition: undefined, // common filter + sort
    },
    {
      name: `idx_${tableName}_created_at`,
      columns: ["created_at"],
    },
    {
      name: `idx_${tableName}_updated_at`,
      columns: ["updated_at"],
    },
  ];
}

/**
 * Check if an index exists
 */
async function indexExists(indexName: string): Promise<boolean> {
  const result = (await db.unsafe(
    `select exists(select 1 from pg_indexes where indexname = $1) as exists`,
    [indexName],
  )) as { exists: boolean }[];

  return result[0]?.exists ?? false;
}

/**
 * Create an index safely
 */
async function createIndex(tableName: string, spec: IndexSpec): Promise<void> {
  assertIdent(tableName, "table");
  for (const col of spec.columns) assertIdent(col, "column");

  const already = await indexExists(spec.name);
  if (already) {
    console.debug(`Index ${spec.name} already exists, skipping`);
    return;
  }

  const columnList = spec.columns.map((c) => quoteIdent(c)).join(", ");
  const condition = spec.condition ? ` ${spec.condition}` : "";
  const unique = spec.unique ? "unique" : "";

  const sql = `create ${unique} index if not exists ${quoteIdent(spec.name)} on ${quoteIdent(tableName)} (${columnList})${condition}`;

  try {
    await db.unsafe(sql);
    console.debug(`Created index ${spec.name}`);
  } catch (e) {
    console.warn(
      `Failed to create index ${spec.name}: ${(e as Error).message}`,
    );
    // Don't throw; missing indexes are not critical, just suboptimal
  }
}

/**
 * Automatically create default indexes for a new table
 */
export async function ensureTableIndexes(tableName: string): Promise<void> {
  assertIdent(tableName, "table");

  const indexes = getDefaultIndexes(tableName);

  for (const spec of indexes) {
    await createIndex(tableName, spec);
  }
}

/**
 * Create a custom index for a specific use case
 */
export async function createCustomIndex(
  tableName: string,
  columnNames: string[],
  options?: { unique?: boolean; condition?: string; indexName?: string },
): Promise<void> {
  assertIdent(tableName, "table");
  for (const col of columnNames) assertIdent(col, "column");

  const indexName =
    options?.indexName ?? `idx_${tableName}_${columnNames.join("_")}`;

  const spec: IndexSpec = {
    name: indexName,
    columns: columnNames,
    unique: options?.unique,
    condition: options?.condition,
  };

  await createIndex(tableName, spec);
}

/**
 * List all indexes on a table
 */
export async function listTableIndexes(
  tableName: string,
): Promise<IndexSpec[]> {
  assertIdent(tableName, "table");

  const result = (await db.unsafe(
    `
    select 
      indexname,
      indexdef
    from pg_indexes
    where tablename = $1
    order by indexname asc
    `,
    [tableName],
  )) as { indexname: string; indexdef: string }[];

  return result.map((r) => ({
    name: r.indexname,
    columns: [], // Would need to parse indexdef to extract columns
    // For simplicity, return basic info
  }));
}

/**
 * Drop an index if it exists
 */
export async function dropIndex(indexName: string): Promise<void> {
  const exists = await indexExists(indexName);
  if (!exists) {
    console.debug(`Index ${indexName} does not exist, skipping drop`);
    return;
  }

  try {
    await db.unsafe(`drop index if exists ${quoteIdent(indexName)}`);
    console.debug(`Dropped index ${indexName}`);
  } catch (e) {
    console.warn(`Failed to drop index ${indexName}: ${(e as Error).message}`);
  }
}
