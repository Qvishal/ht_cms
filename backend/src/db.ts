import postgres from "postgres";
import mysql from "mysql2/promise";

import { loadEnv } from "./env";

export type SqlQuery = { text: string; values: unknown[] };

export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlQuery {
  let text = "";
  const outValues: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i] ?? "";
    if (i < values.length) {
      outValues.push(values[i]);
      text += `$${outValues.length}`;
    }
  }
  return { text, values: outValues };
}

export type DbClient = {
  query<T = Record<string, unknown>>(q: SqlQuery): Promise<T[]>;
  unsafe<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
  exec(text: string, values?: unknown[]): Promise<{ affectedRows?: number }>;
  begin<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
};

function pgClient(url: string): DbClient {
  const pg = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  function wrapTx(tx: postgres.TransactionSql): DbClient {
    return {
      query: async <T>(q: SqlQuery) =>
        (await tx.unsafe(q.text, q.values as any[])) as unknown as T[],
      unsafe: async <T>(text: string, values: unknown[] = []) =>
        (await tx.unsafe(text, values as any[])) as unknown as T[],
      exec: async (text: string, values: unknown[] = []) => {
        await tx.unsafe(text, values as any[]);
        return {};
      },
      // No nested transactions; keep compatibility surface.
      begin: async <T>(fn: (inner: DbClient) => Promise<T>) => fn(wrapTx(tx)),
    };
  }

  return {
    query: async <T>(q: SqlQuery) =>
      (await pg.unsafe(q.text, q.values as any[])) as unknown as T[],
    unsafe: async <T>(text: string, values: unknown[] = []) =>
      (await pg.unsafe(text, values as any[])) as unknown as T[],
    exec: async (text: string, values: unknown[] = []) => {
      await pg.unsafe(text, values as any[]);
      return {};
    },
    begin: async <T>(fn: (tx: DbClient) => Promise<T>) =>
      (pg.begin(async (tx) => fn(wrapTx(tx))) as unknown as Promise<T>),
  };
}

function mysqlClient(url: string): DbClient {
  const pool = mysql.createPool({
    uri: url,
    // Needed for migrations where we run multiple DDL statements at once.
    // Inputs to `unsafe()` are still expected to be trusted or identifier-validated.
    multipleStatements: true,
  });

  function toMysqlSql(text: string): string {
    // Our code uses $1, $2 style placeholders; MySQL expects '?'.
    return text.replace(/\$\d+/g, "?");
  }

  async function queryOn(
    conn: mysql.Pool | mysql.PoolConnection,
    text: string,
    values: unknown[] = [],
  ) {
    const [rows] = await conn.query(toMysqlSql(text), values as any[]);
    return rows as any[];
  }

  function wrapConn(conn: mysql.PoolConnection): DbClient {
    return {
      query: async <T>(q: SqlQuery) => (await queryOn(conn, q.text, q.values)) as T[],
      unsafe: async <T>(text: string, values: unknown[] = []) =>
        (await queryOn(conn, text, values)) as T[],
      exec: async (text: string, values: unknown[] = []) => {
        const [res] = await conn.execute(toMysqlSql(text), values as any[]);
        const packet = res as any;
        return { affectedRows: typeof packet?.affectedRows === "number" ? packet.affectedRows : undefined };
      },
      begin: async <T>(fn: (tx: DbClient) => Promise<T>) => {
        await conn.beginTransaction();
        try {
          const out = await fn(wrapConn(conn));
          await conn.commit();
          return out;
        } catch (e) {
          await conn.rollback();
          throw e;
        }
      },
    };
  }

  return {
    query: async <T>(q: SqlQuery) => (await queryOn(pool, q.text, q.values)) as T[],
    unsafe: async <T>(text: string, values: unknown[] = []) =>
      (await queryOn(pool, text, values)) as T[],
    exec: async (text: string, values: unknown[] = []) => {
      const [res] = await pool.execute(toMysqlSql(text), values as any[]);
      const packet = res as any;
      return { affectedRows: typeof packet?.affectedRows === "number" ? packet.affectedRows : undefined };
    },
    begin: async <T>(fn: (tx: DbClient) => Promise<T>) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const out = await fn(wrapConn(conn));
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}

const env = loadEnv();

export const dbDialect = env.DB_DIALECT;

export const db: DbClient =
  env.DB_DIALECT === "mysql"
    ? mysqlClient(env.MYSQL_URL ?? env.DATABASE_URL ?? "")
    : pgClient(env.DATABASE_URL ?? "");

export async function withTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.begin(fn);
}
