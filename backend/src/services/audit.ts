import { db, sql } from "../db";

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
  const oldValue = input.oldValue === undefined ? null : JSON.stringify(input.oldValue);
  const newValue = input.newValue === undefined ? null : JSON.stringify(input.newValue);

  await db.query(
    sql`
      insert into audit_logs (user_id, action_type, table_id, row_id, old_value, new_value)
      values (
        ${input.userId},
        ${input.actionType},
        ${input.tableId},
        ${input.rowId ?? null},
        ${oldValue},
        ${newValue}
      )
    `,
  );
}

export async function listAuditLogs(input: {
  userId?: string;
  tableId?: string;
  actionType?: AuditActionType;
  limit: number;
  offset: number;
}) {
  const rows = await db.query<{
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
  }>(
    sql`
      select
        l.id,
        l.action_type as actionType,
        l.created_at as createdAt,
        l.row_id as rowId,
        l.table_id as tableId,
        t.name as tableName,
        l.user_id as userId,
        u.email as userEmail,
        u.name as userName,
        l.old_value as oldValue,
        l.new_value as newValue
      from audit_logs l
      left join users u on u.id = l.user_id
      left join cms_tables t on t.id = l.table_id
      where (${input.userId ?? null} is null or l.user_id = ${input.userId ?? null})
        and (${input.tableId ?? null} is null or l.table_id = ${input.tableId ?? null})
        and (${input.actionType ?? null} is null or l.action_type = ${input.actionType ?? null})
      order by l.created_at desc
      limit ${input.limit} offset ${input.offset}
    `,
  );

  // MySQL may return JSON columns as strings; normalize for UI.
  return rows.map((r) => ({
    ...r,
    oldValue:
      typeof r.oldValue === "string"
        ? safeJsonParse(r.oldValue)
        : r.oldValue,
    newValue:
      typeof r.newValue === "string"
        ? safeJsonParse(r.newValue)
        : r.newValue,
  }));
}

function safeJsonParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
