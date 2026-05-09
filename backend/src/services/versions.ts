import { db, sql } from "../db";
import { newId } from "../lib/uuid";

export async function createRowVersion(input: {
  tableId: string;
  rowId: string;
  data: unknown;
  updatedBy: string | null;
}): Promise<void> {
  const rows = await db.query<{ next: number }>(
    sql`
      select coalesce(max(version_number), 0) + 1 as next
      from row_versions
      where table_id = ${input.tableId} and row_id = ${input.rowId}
    `,
  );
  const next = rows[0]?.next ?? 1;
  const id = newId();
  const data = JSON.stringify(input.data);
  await db.query(
    sql`
      insert into row_versions (id, table_id, row_id, version_number, data, updated_by)
      values (
        ${id},
        ${input.tableId},
        ${input.rowId},
        ${next},
        ${data},
        ${input.updatedBy}
      )
    `,
  );
}

export async function listRowVersions(input: {
  tableId: string;
  rowId: string;
}) {
  const rows = await db.query<{
    id: string;
    versionNumber: number;
    createdAt: string;
    updatedBy: string | null;
    updatedByEmail: string | null;
    updatedByName: string | null;
    data: unknown;
  }>(
    sql`
      select
        v.id,
        v.version_number as versionNumber,
        v.created_at as createdAt,
        v.updated_by as updatedBy,
        u.email as updatedByEmail,
        u.name as updatedByName,
        v.data as data
      from row_versions v
      left join users u on u.id = v.updated_by
      where v.table_id = ${input.tableId} and v.row_id = ${input.rowId}
      order by v.version_number desc
      limit 200
    `,
  );
  return rows.map((r) => ({
    ...r,
    data: typeof r.data === "string" ? safeJsonParse(r.data) : r.data,
  }));
}

export async function getRowVersionById(input: {
  tableId: string;
  versionId: string;
}) {
  const rows = await db.query<{ id: string; row_id: string; data: unknown }>(
    sql`
      select id, row_id, data
      from row_versions
      where table_id = ${input.tableId} and id = ${input.versionId}
      limit 1
    `,
  );
  const row = rows[0] ?? null;
  if (!row) return null;
  return {
    ...row,
    data: typeof row.data === "string" ? safeJsonParse(row.data) : row.data,
  };
}

function safeJsonParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
