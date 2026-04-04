import { db, withTx } from "../db";
import { assertIdent } from "../lib/ids";

export type AccessType = "read" | "write";

export type TableInfo = { id: string; name: string };

export async function listAllTables(): Promise<TableInfo[]> {
  const rows =
    await db<TableInfo>`select id, name from cms_tables order by name asc`;
  return rows;
}

export async function listTablesForUser(userId: string): Promise<string[]> {
  const rows = await db<{ name: string }>`
    select t.name
    from cms_tables t
    join table_permissions p on p.table_id = t.id
    where p.user_id = ${userId}
    order by t.name asc
  `;
  return rows.map((r) => r.name);
}

export async function getAccessTypeForUserOnTableName(
  userId: string,
  tableName: string,
): Promise<AccessType | null> {
  assertIdent(tableName, "table");
  const rows = await db<{ access_type: AccessType }>`
    select p.access_type
    from table_permissions p
    join cms_tables t on t.id = p.table_id
    where p.user_id = ${userId}
      and t.name = ${tableName}
    limit 1
  `;
  return rows[0]?.access_type ?? null;
}

export async function listPermissionsForUser(
  userId: string,
): Promise<
  Array<{ tableId: string; tableName: string; accessType: AccessType }>
> {
  const rows = await db<{
    tableId: string;
    tableName: string;
    accessType: AccessType;
  }>`
    select t.id as "tableId", t.name as "tableName", p.access_type as "accessType"
    from table_permissions p
    join cms_tables t on t.id = p.table_id
    where p.user_id = ${userId}
    order by t.name asc
  `;
  return rows;
}

export async function replacePermissionsForUser(
  userId: string,
  permissions: Array<{ tableId: string; accessType: AccessType }>,
): Promise<void> {
  await withTx(async (tx) => {
    // Replace-in-transaction so the UI can send a full snapshot.
    await tx`delete from table_permissions where user_id = ${userId}`;
    for (const p of permissions) {
      await tx`
        insert into table_permissions (user_id, table_id, access_type)
        values (${userId}, ${p.tableId}, ${p.accessType})
        on conflict (user_id, table_id)
        do update set access_type = excluded.access_type
      `;
    }
  });
}
