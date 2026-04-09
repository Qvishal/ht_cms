import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  JWT_SECRET: z.string().min(16).or(z.string().min(1)),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3001"),
  CACHE_STRATEGY: z
    .enum(["HYBRID", "REDIS_ONLY", "DISABLED"])
    .default("HYBRID"),
  CACHE_PUBLIC_ONLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  VARNISH_HOST: z.string().default("localhost:6081"),
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
  return parsed.data;
}
