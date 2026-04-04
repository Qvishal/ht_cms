import postgres from "postgres";
import { loadEnv } from "./env";

const env = loadEnv();

export const db = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function withTx<T>(
  fn: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  return db.begin((tx) => fn(tx));
}
