import { db } from "../db";

export async function createRowVersion(input: {
  tableId: string;
  rowId: string;
  data: unknown;
  updatedBy: string | null;
}): Promise<void> {
  const rows = await db<{ next: number }>`
    select coalesce(max(version_number), 0)::int + 1 as next
    from row_versions
    where table_id = ${input.tableId} and row_id = ${input.rowId}
  `;
  const next = rows[0]?.next ?? 1;
  await db`
    insert into row_versions (table_id, row_id, version_number, data, updated_by)
    values (
      ${input.tableId},
      ${input.rowId},
      ${next},
      ${input.data},
      ${input.updatedBy}
    )
  `;
}

export async function listRowVersions(input: {
  tableId: string;
  rowId: string;
}) {
  const rows = await db<{
    id: string;
    versionNumber: number;
    createdAt: string;
    updatedBy: string | null;
    updatedByEmail: string | null;
    updatedByName: string | null;
    data: unknown;
  }>`
    select
      v.id,
      v.version_number as "versionNumber",
      v.created_at as "createdAt",
      v.updated_by as "updatedBy",
      u.email as "updatedByEmail",
      u.name as "updatedByName",
      v.data as "data"
    from row_versions v
    left join users u on u.id = v.updated_by
    where v.table_id = ${input.tableId} and v.row_id = ${input.rowId}
    order by v.version_number desc
    limit 200
  `;
  return rows;
}

export async function getRowVersionById(input: {
  tableId: string;
  versionId: string;
}) {
  const rows = await db<{ id: string; row_id: string; data: unknown }>`
    select id, row_id, data
    from row_versions
    where table_id = ${input.tableId} and id = ${input.versionId}
    limit 1
  `;
  return rows[0] ?? null;
}
