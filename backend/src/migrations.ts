import { db } from "./db";

export async function migrate(): Promise<void> {
  await db.unsafe(`
    create extension if not exists "pgcrypto";

    create table if not exists admin_users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists cms_tables (
      id uuid primary key default gen_random_uuid(),
      name text not null unique,
      created_at timestamptz not null default now()
    );

    create table if not exists cms_columns (
      id uuid primary key default gen_random_uuid(),
      table_name text not null references cms_tables(name) on delete cascade,
      name text not null,
      type text not null,
      required boolean not null default false,
      created_at timestamptz not null default now(),
      unique (table_name, name)
    );
  `);
}

