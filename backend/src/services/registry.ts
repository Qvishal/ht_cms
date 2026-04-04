import { db, withTx } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";
import { sqlTypeFor } from "../schema/sql";
import type { ColumnDef, TableDef } from "../schema/types";

export async function getTables(): Promise<string[]> {
  const rows = await db<{
    name: string;
  }>`select name from cms_tables order by name asc`;
  return rows.map((r) => r.name);
}

export async function getTableInfoByName(
  table: string,
): Promise<{ id: string; name: string } | null> {
  assertIdent(table, "table");
  const rows = await db<{ id: string; name: string }>`
    select id, name
    from cms_tables
    where name = ${table}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getColumns(
  table: string,
  includeInactive = false,
): Promise<Array<ColumnDef & { active: boolean }>> {
  assertIdent(table, "table");
  const rows = await db<{
    name: string;
    type: string;
    required: boolean;
    active: boolean;
  }>`
    select name, type, required, active
    from cms_columns
    where table_name = ${table}
      and (${includeInactive} = true or active = true)
    order by created_at asc
  `;
  return rows.map((r) => ({
    name: r.name,
    type: r.type === "json" ? "text" : (r.type as ColumnDef["type"]),
    required: r.required,
    active: r.active,
  }));
}

export async function tableExistsInRegistry(table: string): Promise<boolean> {
  assertIdent(table, "table");
  const rows = await db<{ count: number }>`
    select count(*)::int as count from cms_tables where name = ${table}
  `;
  return rows[0]?.count > 0;
}

export async function ensurePhysicalTable(table: TableDef): Promise<void> {
  assertIdent(table.name, "table");
  for (const col of table.columns) assertIdent(col.name, "column");

  const tableName = quoteIdent(table.name);
  const colSql = table.columns
    .map((c) => {
      const nullability = c.required ? "not null" : "null";
      return `${quoteIdent(c.name)} ${sqlTypeFor(c.type)} ${nullability}`;
    })
    .join(",\n      ");

  await db.unsafe(`
    create table if not exists ${tableName} (
      id uuid primary key default gen_random_uuid(),
      ${colSql ? `${colSql},` : ""}
      created_by uuid,
      is_deleted boolean not null default false,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  // Trigger to auto-update updated_at
  await db.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
        create or replace function set_updated_at()
        returns trigger as $fn$
        begin
          new.updated_at = now();
          return new;
        end;
        $fn$ language plpgsql;
      end if;
    end $$;
  `);

  await db.unsafe(`
    do $$
    begin
      if not exists (
        select 1
        from pg_trigger
        where tgname = 'trg_${table.name}_updated_at'
      ) then
        create trigger ${quoteIdent(`trg_${table.name}_updated_at`)}
        before update on ${tableName}
        for each row execute function set_updated_at();
      end if;
    end $$;
  `);
}

export async function addPhysicalColumn(
  table: string,
  col: ColumnDef,
): Promise<void> {
  assertIdent(table, "table");
  assertIdent(col.name, "column");

  const tableName = quoteIdent(table);
  await db.unsafe(
    `alter table ${tableName} add column if not exists ${quoteIdent(col.name)} ${sqlTypeFor(
      col.type,
    )} null;`,
  );

  // Safe type upgrades:
  // - Legacy `json/jsonb` is now treated as `text` for long descriptions.
  // If a column exists as jsonb, cast it to text (no data loss).
  if (col.type === "text" || col.type === "json") {
    const info = await db<{ udt_name: string }>`
      select udt_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${col.name}
      limit 1
    `;
    if (info[0]?.udt_name === "jsonb") {
      const colIdent = quoteIdent(col.name);
      await db.unsafe(
        `alter table ${tableName} alter column ${colIdent} type text using ${colIdent}::text;`,
      );
    }
  }

  // If the table is empty, we can safely enforce NOT NULL at the DB level too.
  if (col.required) {
    const rows = await db.unsafe(
      `select count(*)::int as count from ${tableName}`,
    );
    const count = rows?.[0]?.count ?? 0;
    if (count === 0) {
      await db.unsafe(
        `alter table ${tableName} alter column ${quoteIdent(col.name)} set not null;`,
      );
    }
  }
}

export async function upsertRegistryForSchema(
  tables: TableDef[],
): Promise<void> {
  await withTx(async (tx) => {
    for (const t of tables) {
      assertIdent(t.name, "table");
      await tx`insert into cms_tables (name) values (${t.name}) on conflict (name) do nothing`;
      for (const c of t.columns) {
        assertIdent(c.name, "column");
        await tx`
          insert into cms_columns (table_name, name, type, required)
          values (${t.name}, ${c.name}, ${c.type}, ${!!c.required})
          on conflict (table_name, name)
          do update set type = excluded.type, required = excluded.required, active = true
        `;
      }
    }
  });
}

export async function setColumnActive(
  table: string,
  column: string,
  active: boolean,
): Promise<boolean> {
  assertIdent(table, "table");
  assertIdent(column, "column");
  const rows = await db<{ id: string }>`
    update cms_columns
    set active = ${active}
    where table_name = ${table} and name = ${column}
    returning id
  `;
  return !!rows[0];
}

export async function updateRegistryColumn(
  table: string,
  column: string,
  updates: { type?: ColumnDef["type"]; required?: boolean; active?: boolean },
): Promise<boolean> {
  assertIdent(table, "table");
  assertIdent(column, "column");

  const nextType = updates.type ?? null;
  const nextReq = updates.required ?? null;
  const nextActive = updates.active ?? null;

  const rows = await db<{ id: string }>`
    update cms_columns
    set
      type = coalesce(${nextType}, type),
      required = coalesce(${nextReq}, required),
      active = coalesce(${nextActive}, active)
    where table_name = ${table} and name = ${column}
    returning id
  `;
  return !!rows[0];
}
