import { db, dbDialect, sql, withTx } from "../db";
import { assertIdent, quoteIdent } from "../lib/ids";
import { sqlTypeFor } from "../schema/sql";
import type { ColumnDef, TableDef } from "../schema/types";

export async function getTables(): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    sql`select name from cms_tables order by name asc`,
  );
  return rows.map((r) => r.name);
}

export async function getTableInfoByName(
  table: string,
): Promise<{ id: string; name: string } | null> {
  assertIdent(table, "table");
  const rows = await db.query<{ id: string; name: string }>(
    sql`
      select id, name
      from cms_tables
      where name = ${table}
      limit 1
    `,
  );
  return rows[0] ?? null;
}

export async function getColumns(
  table: string,
  includeInactive = false,
): Promise<Array<ColumnDef & { active: boolean }>> {
  assertIdent(table, "table");
  const rows = await db.query<{
    name: string;
    type: string;
    required: boolean;
    active: boolean;
  }>(
    sql`
      select name, type, required, active
      from cms_columns
      where table_name = ${table}
        and (${includeInactive} = true or active = true)
      order by created_at asc
    `,
  );
  return rows.map((r) => ({
    name: r.name,
    type: r.type === "json" ? "text" : (r.type as ColumnDef["type"]),
    required: r.required,
    active: r.active,
  }));
}

export async function tableExistsInRegistry(table: string): Promise<boolean> {
  assertIdent(table, "table");
  const rows = await db.query<{ count: number | string }>(
    sql`select count(*) as count from cms_tables where name = ${table}`,
  );
  return Number(rows[0]?.count ?? 0) > 0;
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

  if (dbDialect === "mysql") {
    await db.unsafe(`
      create table if not exists ${tableName} (
        s_no bigint unsigned not null auto_increment primary key,
        id char(36) not null default (uuid()),
        ${colSql ? `${colSql},` : ""}
        created_by char(36),
        is_deleted boolean not null default false,
        deleted_at datetime null,
        created_at timestamp not null default current_timestamp,
        updated_at timestamp not null default current_timestamp on update current_timestamp,
        unique key uniq_${table.name}_id (id)
      );
    `);
  } else {
    await db.unsafe(`
      create table if not exists ${tableName} (
        s_no bigserial primary key,
        id uuid not null default gen_random_uuid() unique,
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
}

export async function addPhysicalColumn(
  table: string,
  col: ColumnDef,
): Promise<void> {
  assertIdent(table, "table");
  assertIdent(col.name, "column");

  const tableName = quoteIdent(table);
  if (dbDialect === "mysql") {
    // MySQL has no ADD COLUMN IF NOT EXISTS — check information_schema first.
    const exists = await db.query<{ cnt: number | string }>(
      sql`
        select count(*) as cnt
        from information_schema.columns
        where table_schema = database()
          and table_name  = ${table}
          and column_name = ${col.name}
      `,
    );
    if (Number(exists[0]?.cnt ?? 0) > 0) return; // column already exists, skip

    await db.unsafe(
      `alter table ${tableName} add column ${quoteIdent(col.name)} ${sqlTypeFor(
        col.type,
      )} null;`,
    );
  } else {
    await db.unsafe(
      `alter table ${tableName} add column if not exists ${quoteIdent(col.name)} ${sqlTypeFor(
        col.type,
      )} null;`,
    );
  }

  // Safe type upgrades:
  // - Legacy `json/jsonb` is now treated as `text` for long descriptions.
  // If a column exists as jsonb, cast it to text (no data loss).
  if (col.type === "text" || col.type === "json") {
    if (dbDialect !== "mysql") {
      const info = await db.query<{ udt_name: string }>(
        sql`
          select udt_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = ${table}
            and column_name = ${col.name}
          limit 1
        `,
      );
      if (info[0]?.udt_name === "jsonb") {
        const colIdent = quoteIdent(col.name);
        await db.unsafe(
          `alter table ${tableName} alter column ${colIdent} type text using ${colIdent}::text;`,
        );
      }
    }
  }

  // If the table is empty, we can safely enforce NOT NULL at the DB level too.
  if (col.required) {
    if (dbDialect !== "mysql") {
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
}


export async function upsertRegistryForSchema(
  tables: TableDef[],
): Promise<void> {
  await withTx(async (tx) => {
    for (const t of tables) {
      assertIdent(t.name, "table");
      if (dbDialect === "mysql") {
        await tx.unsafe(`insert ignore into cms_tables (name) values ($1)`, [
          t.name,
        ]);
      } else {
        await tx.query(
          sql`
            insert into cms_tables (name)
            values (${t.name})
            on conflict (name) do nothing
          `,
        );
      }
      for (const c of t.columns) {
        assertIdent(c.name, "column");
        if (dbDialect === "mysql") {
          await tx.unsafe(
            `
              insert into cms_columns (table_name, name, type, required, active)
              values ($1, $2, $3, $4, true)
              on duplicate key update
                type = values(type),
                required = values(required),
                active = true
            `,
            [t.name, c.name, c.type, !!c.required],
          );
        } else {
          await tx.query(
            sql`
              insert into cms_columns (table_name, name, type, required)
              values (${t.name}, ${c.name}, ${c.type}, ${!!c.required})
              on conflict (table_name, name)
              do update set type = excluded.type, required = excluded.required, active = true
            `,
          );
        }
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
  await db.query(
    sql`
      update cms_columns
      set active = ${active}
      where table_name = ${table} and name = ${column}
    `,
  );
  const rows = await db.query<{ id: string }>(
    sql`
      select id
      from cms_columns
      where table_name = ${table} and name = ${column}
      limit 1
    `,
  );
  return !!rows[0]?.id;
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

  await db.query(
    sql`
      update cms_columns
      set
        type = coalesce(${nextType}, type),
        required = coalesce(${nextReq}, required),
        active = coalesce(${nextActive}, active)
      where table_name = ${table} and name = ${column}
    `,
  );
  const rows = await db.query<{ id: string }>(
    sql`
      select id
      from cms_columns
      where table_name = ${table} and name = ${column}
      limit 1
    `,
  );
  return !!rows[0]?.id;
}
