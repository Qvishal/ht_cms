import { db } from "../db";

export type AuditActionType =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STRUCTURE_CHANGE"
  | "PERMISSION_CHANGE";

export async function writeAuditLog(input: {
  userId: string | null;
  actionType: AuditActionType;
  tableId: string | null;
  rowId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  await db`
    insert into audit_logs (user_id, action_type, table_id, row_id, old_value, new_value)
    values (
      ${input.userId},
      ${input.actionType},
      ${input.tableId},
      ${input.rowId ?? null},
      ${input.oldValue === undefined ? null : input.oldValue},
      ${input.newValue === undefined ? null : input.newValue}
    )
  `;
}

export async function listAuditLogs(input: {
  userId?: string;
  tableId?: string;
  actionType?: AuditActionType;
  limit: number;
  offset: number;
}) {
  const rows = await db<{
    id: string;
    actionType: AuditActionType;
    createdAt: string;
    rowId: string | null;
    tableId: string | null;
    tableName: string | null;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    oldValue: unknown | null;
    newValue: unknown | null;
  }>`
    select
      l.id,
      l.action_type as "actionType",
      l.created_at as "createdAt",
      l.row_id as "rowId",
      l.table_id as "tableId",
      t.name as "tableName",
      l.user_id as "userId",
      u.email as "userEmail",
      u.name as "userName",
      l.old_value as "oldValue",
      l.new_value as "newValue"
    from audit_logs l
    left join users u on u.id = l.user_id
    left join cms_tables t on t.id = l.table_id
    where (${input.userId ?? null}::uuid is null or l.user_id = ${input.userId ?? null})
      and (${input.tableId ?? null}::uuid is null or l.table_id = ${input.tableId ?? null})
      and (${input.actionType ?? null}::text is null or l.action_type = ${input.actionType ?? null})
    order by l.created_at desc
    limit ${input.limit} offset ${input.offset}
  `;
  return rows;
}
