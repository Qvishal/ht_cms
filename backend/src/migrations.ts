import { readFile, writeFile } from "node:fs/promises";
import { db, dbDialect, sql } from "./db";
import { assertIdent, quoteIdent } from "./lib/ids";
import { schemaPath } from "./schema/store";

export async function migrate(): Promise<void> {
  if (dbDialect === "mysql") {
    await migrateMysql();
  } else {
    await migratePostgres();
  }
}

async function migratePostgres(): Promise<void> {
  await db.unsafe(`
    create extension if not exists "pgcrypto";

    create table if not exists admin_users (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists users (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      email text not null unique,
      name text,
      password_hash text not null,
      role text not null default 'user' check (role in ('admin','user')),
      created_at timestamptz not null default now()
    );

    create table if not exists cms_tables (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      name text not null unique,
      created_at timestamptz not null default now()
    );

    create table if not exists table_metadata (
      table_id uuid primary key references cms_tables(id) on delete cascade,
      visibility_mode text not null default 'GLOBAL_ACCESS' check (visibility_mode in ('GLOBAL_ACCESS','USER_SCOPED')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists cms_columns (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      table_name text not null references cms_tables(name) on delete cascade,
      name text not null,
      type text not null,
      required boolean not null default false,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      unique (table_name, name)
    );

    create table if not exists table_permissions (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      user_id uuid not null references users(id) on delete cascade,
      table_id uuid not null references cms_tables(id) on delete cascade,
      access_type text not null check (access_type in ('read','write')),
      created_at timestamptz not null default now(),
      unique (user_id, table_id)
    );

    create index if not exists idx_table_permissions_user_id on table_permissions(user_id);
    create index if not exists idx_table_permissions_table_id on table_permissions(table_id);

    create table if not exists audit_logs (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      user_id uuid references users(id) on delete set null,
      action_type text not null check (action_type in ('CREATE','UPDATE','DELETE','STRUCTURE_CHANGE','PERMISSION_CHANGE')),
      table_id uuid references cms_tables(id) on delete set null,
      row_id uuid,
      old_value jsonb,
      new_value jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);
    create index if not exists idx_audit_logs_user_id on audit_logs(user_id);
    create index if not exists idx_audit_logs_table_id on audit_logs(table_id);
    create index if not exists idx_audit_logs_action_type on audit_logs(action_type);

    create table if not exists row_versions (
      s_no bigserial primary key,
      id uuid not null default gen_random_uuid() unique,
      table_id uuid not null references cms_tables(id) on delete cascade,
      row_id uuid not null,
      version_number int not null,
      data jsonb not null,
      updated_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      unique (table_id, row_id, version_number)
    );

    create index if not exists idx_row_versions_row_id on row_versions(row_id);
    create index if not exists idx_row_versions_table_id on row_versions(table_id);
    create index if not exists idx_row_versions_created_at on row_versions(created_at desc);
  `);

  // Additive migration for older installs (safe, no data loss).
  await db.unsafe(`
    alter table cms_columns add column if not exists active boolean not null default true;
    alter table users add column if not exists name text;
    create table if not exists table_metadata (
      table_id uuid primary key references cms_tables(id) on delete cascade,
      visibility_mode text not null default 'GLOBAL_ACCESS' check (visibility_mode in ('GLOBAL_ACCESS','USER_SCOPED')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  // Legacy migration: copy existing admin_users → users as role=admin (no data loss).
  await db.query(
    sql`
      insert into users (id, email, password_hash, role, created_at)
      select id, email, password_hash, 'admin', created_at
      from admin_users
      on conflict (email) do nothing
    `,
  );

  await migrateJsonToTextPostgres();
  await ensureMetadataRowsPostgres();
  await ensureGovernanceFieldsPostgres();
}

async function migrateMysql(): Promise<void> {
  // MySQL 8+ compatible schema. We store UUIDs as CHAR(36).
  await db.unsafe(`
    create table if not exists admin_users (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      email varchar(255) not null unique,
      password_hash text not null,
      created_at timestamp not null default current_timestamp,
      unique key uniq_admin_users_id (id)
    );

    create table if not exists users (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      email varchar(255) not null unique,
      name varchar(120) null,
      password_hash text not null,
      role varchar(10) not null default 'user',
      created_at timestamp not null default current_timestamp,
      check (role in ('admin','user')),
      unique key uniq_users_id (id)
    );

    create table if not exists cms_tables (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      name varchar(128) not null unique,
      created_at timestamp not null default current_timestamp,
      unique key uniq_cms_tables_id (id)
    );

    create table if not exists table_metadata (
      table_id char(36) primary key,
      visibility_mode varchar(20) not null default 'GLOBAL_ACCESS',
      created_at timestamp not null default current_timestamp,
      updated_at timestamp not null default current_timestamp on update current_timestamp,
      check (visibility_mode in ('GLOBAL_ACCESS','USER_SCOPED')),
      constraint fk_table_metadata_table foreign key (table_id) references cms_tables(id) on delete cascade
    );

    create table if not exists cms_columns (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      table_name varchar(128) not null,
      name varchar(128) not null,
      type varchar(32) not null,
      required boolean not null default false,
      active boolean not null default true,
      created_at timestamp not null default current_timestamp,
      unique key uniq_cms_columns (table_name, name),
      unique key uniq_cms_columns_id (id)
    );

    create table if not exists table_permissions (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      user_id char(36) not null,
      table_id char(36) not null,
      access_type varchar(10) not null,
      created_at timestamp not null default current_timestamp,
      unique key uniq_table_permissions (user_id, table_id),
      check (access_type in ('read','write')),
      unique key uniq_table_permissions_id (id),
      constraint fk_table_permissions_user foreign key (user_id) references users(id) on delete cascade,
      constraint fk_table_permissions_table foreign key (table_id) references cms_tables(id) on delete cascade
    );

    create table if not exists audit_logs (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      user_id char(36) null,
      action_type varchar(32) not null,
      table_id char(36) null,
      row_id char(36) null,
      old_value json null,
      new_value json null,
      created_at timestamp not null default current_timestamp,
      check (action_type in ('CREATE','UPDATE','DELETE','STRUCTURE_CHANGE','PERMISSION_CHANGE')),
      unique key uniq_audit_logs_id (id),
      constraint fk_audit_logs_user foreign key (user_id) references users(id) on delete set null,
      constraint fk_audit_logs_table foreign key (table_id) references cms_tables(id) on delete set null
    );

    create table if not exists row_versions (
      s_no bigint unsigned not null auto_increment primary key,
      id char(36) not null default (uuid()),
      table_id char(36) not null,
      row_id char(36) not null,
      version_number int not null,
      data json not null,
      updated_by char(36) null,
      created_at timestamp not null default current_timestamp,
      unique key uniq_row_versions (table_id, row_id, version_number),
      unique key uniq_row_versions_id (id),
      constraint fk_row_versions_table foreign key (table_id) references cms_tables(id) on delete cascade,
      constraint fk_row_versions_user foreign key (updated_by) references users(id) on delete set null
    );
  `);

  // Legacy migration: copy existing admin_users → users as role=admin (no data loss).
  await db.unsafe(
    `
      insert ignore into users (id, email, password_hash, role, created_at)
      select id, email, password_hash, 'admin', created_at
      from admin_users
    `,
  );

  await migrateJsonToTextMysql();
  await ensureMetadataRowsMysql();
  await ensureGovernanceFieldsMysql();
}

async function migrateJsonToTextPostgres(): Promise<void> {
  // Schema upgrade: `json` was previously used for long descriptions; migrate to `text`.
  const legacyJsonCols = await db.query<{ table_name: string; name: string }>(
    sql`
      select table_name, name
      from cms_columns
      where type = 'json'
      order by created_at asc
    `,
  );
  for (const col of legacyJsonCols) {
    assertIdent(col.table_name, "table");
    assertIdent(col.name, "column");
    const tableIdent = quoteIdent(col.table_name);
    const colIdent = quoteIdent(col.name);
    await db.unsafe(
      `alter table ${tableIdent} alter column ${colIdent} type text using ${colIdent}::text;`,
    );
  }

  await db.query(sql`update cms_columns set type = 'text' where type = 'json'`);
  await migrateSchemaFileJsonToText();
}

async function migrateJsonToTextMysql(): Promise<void> {
  const legacyJsonCols = await db.query<{ table_name: string; name: string }>(
    sql`
      select table_name, name
      from cms_columns
      where type = 'json'
      order by created_at asc
    `,
  );
  for (const col of legacyJsonCols) {
    assertIdent(col.table_name, "table");
    assertIdent(col.name, "column");
    const tableIdent = quoteIdent(col.table_name);
    const colIdent = quoteIdent(col.name);
    await tryUnsafe(
      `alter table ${tableIdent} modify column ${colIdent} longtext null`,
    );
  }
  await db.query(sql`update cms_columns set type = 'text' where type = 'json'`);
  await migrateSchemaFileJsonToText();
}

async function ensureMetadataRowsPostgres(): Promise<void> {
  await db.query(
    sql`
      insert into table_metadata (table_id)
      select id from cms_tables
      on conflict (table_id) do nothing
    `,
  );
}

async function ensureMetadataRowsMysql(): Promise<void> {
  await db.unsafe(`
    insert ignore into table_metadata (table_id)
    select id from cms_tables
  `);
}

async function ensureGovernanceFieldsPostgres(): Promise<void> {
  const adminIdRows = await db.query<{ id: string }>(
    sql`
      select id from users where role = 'admin' order by created_at asc limit 1
    `,
  );
  const adminId = adminIdRows[0]?.id ?? null;
  const physicalTables = await db.query<{ name: string; id: string }>(
    sql`select name, id from cms_tables order by created_at asc`,
  );
  for (const t of physicalTables) {
    assertIdent(t.name, "table");
    const tableIdent = quoteIdent(t.name);
    await db.unsafe(`
      alter table ${tableIdent}
        add column if not exists created_by uuid,
        add column if not exists is_deleted boolean not null default false,
        add column if not exists deleted_at timestamptz;
    `);
    await db.unsafe(`
      create index if not exists ${quoteIdent(`idx_${t.name}_created_by`)} on ${tableIdent}(created_by);
    `);
    await db.unsafe(`
      create index if not exists ${quoteIdent(`idx_${t.name}_is_deleted`)} on ${tableIdent}(is_deleted);
    `);
    if (adminId) {
      await db.unsafe(
        `update ${tableIdent} set created_by = $1 where created_by is null`,
        [adminId],
      );
    }
  }
}

async function ensureGovernanceFieldsMysql(): Promise<void> {
  const adminIdRows = await db.query<{ id: string }>(
    sql`
      select id from users where role = 'admin' order by created_at asc limit 1
    `,
  );
  const adminId = adminIdRows[0]?.id ?? null;
  const physicalTables = await db.query<{ name: string; id: string }>(
    sql`select name, id from cms_tables order by created_at asc`,
  );
  for (const t of physicalTables) {
    assertIdent(t.name, "table");
    const tableIdent = quoteIdent(t.name);
    await tryUnsafe(`
      alter table ${tableIdent}
        add column if not exists created_by char(36),
        add column if not exists is_deleted boolean not null default false,
        add column if not exists deleted_at datetime null;
    `);
    // Index creation is best-effort (MySQL lacks CREATE INDEX IF NOT EXISTS).
    await tryUnsafe(`create index idx_${t.name}_created_by on ${tableIdent}(created_by);`);
    await tryUnsafe(`create index idx_${t.name}_is_deleted on ${tableIdent}(is_deleted);`);
    if (adminId) {
      await db.unsafe(
        `update ${tableIdent} set created_by = $1 where created_by is null`,
        [adminId],
      );
    }
  }
}

async function tryUnsafe(query: string): Promise<void> {
  try {
    await db.unsafe(query);
  } catch {
    // Ignore (idempotency/best-effort indexes and ALTERs).
  }
}

async function migrateSchemaFileJsonToText(): Promise<void> {
  const filePath = schemaPath();
  try {
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    if (!json || typeof json !== "object") return;
    const obj = json as {
      version?: unknown;
      tables?: Array<{
        name: unknown;
        columns?: Array<{ name: unknown; type?: unknown; required?: unknown }>;
      }>;
    };
    if (!Array.isArray(obj.tables)) return;
    let changed = false;
    const next = {
      ...obj,
      tables: obj.tables.map((t) => {
        if (!Array.isArray(t.columns)) return t;
        return {
          ...t,
          columns: t.columns.map((c) => {
            if (c?.type === "json") {
              changed = true;
              return { ...c, type: "text" };
            }
            return c;
          }),
        };
      }),
    };
    if (!changed) return;
    await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // Ignore if schema file doesn't exist or is invalid.
  }
}
