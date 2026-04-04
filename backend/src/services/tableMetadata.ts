import { db } from "../db";
import { assertIdent } from "../lib/ids";

export type VisibilityMode = "GLOBAL_ACCESS" | "USER_SCOPED";

export async function getVisibilityMode(
  tableName: string,
): Promise<VisibilityMode> {
  assertIdent(tableName, "table");
  // Ensure metadata row exists (idempotent).
  await db`
    insert into table_metadata (table_id)
    select id from cms_tables where name = ${tableName}
    on conflict (table_id) do nothing
  `;

  const rows = await db<{ visibility_mode: VisibilityMode }>`
    select m.visibility_mode
    from table_metadata m
    join cms_tables t on t.id = m.table_id
    where t.name = ${tableName}
    limit 1
  `;
  return rows[0]?.visibility_mode ?? "GLOBAL_ACCESS";
}

export async function setVisibilityMode(
  tableName: string,
  mode: VisibilityMode,
): Promise<void> {
  assertIdent(tableName, "table");
  await db`
    insert into table_metadata (table_id, visibility_mode)
    select id, ${mode} from cms_tables where name = ${tableName}
    on conflict (table_id)
    do update set visibility_mode = excluded.visibility_mode, updated_at = now()
  `;
}
