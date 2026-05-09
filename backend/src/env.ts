import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HTTPS_PORT: z.coerce.number().int().min(1).max(65535).default(4433),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DB_DIALECT: z.enum(["postgres", "mysql"]).default("mysql"),
  // Backward compatible: existing installs use DATABASE_URL (Postgres).
  DATABASE_URL: z.string().min(1).optional(),
  // New: MySQL connection URL, e.g. mysql://user:pass@host:3306/db
  MYSQL_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  JWT_SECRET: z.string().min(16).or(z.string().min(1)),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  CACHE_STRATEGY: z
    .enum(["HYBRID", "REDIS_ONLY", "DISABLED"])
    .default("HYBRID"),
  CACHE_PUBLIC_ONLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  VARNISH_HOST: z.string().default("localhost:6081"),
  // HTTPS / TLS enforcement
  FORCE_HTTPS: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
  SSL_CERT_PATH: z.string().optional(),  // path to TLS certificate (.pem / .crt)
  SSL_KEY_PATH:  z.string().optional(),  // path to TLS private key (.pem / .key)
  // Payload Encryption
  PAYLOAD_ENCRYPTION_KEY: z.string().length(64).optional(), // 32-byte hex string
  ENCRYPT_PAYLOADS: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment variables");
  }
  if (parsed.data.DB_DIALECT === "postgres" && !parsed.data.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when DB_DIALECT=postgres");
  }
  if (
    parsed.data.DB_DIALECT === "mysql" &&
    !parsed.data.MYSQL_URL &&
    !parsed.data.DATABASE_URL
  ) {
    throw new Error(
      "MYSQL_URL (recommended) or DATABASE_URL is required when DB_DIALECT=mysql",
    );
  }
  return parsed.data;
}
