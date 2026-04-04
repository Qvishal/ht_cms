import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { z } from "zod";

import { db } from "./db";
import { loadEnv } from "./env";
import { migrate } from "./migrations";
import { hashPassword, verifyPassword } from "./auth/password";
import { ApplySchemaSchema, ColumnDefSchema, TableDefSchema } from "./schema/validation";
import { applySchema, currentSchema } from "./services/schemaApply";
import { createRow, deleteRow, getRow, listRows, updateRow } from "./services/crud";
import { addPhysicalColumn, ensurePhysicalTable, getColumns, getTables, hasAnyAdmin, tableExistsInRegistry, upsertRegistryForSchema } from "./services/registry";

const env = loadEnv();

await migrate();

const app = new Elysia()
  .use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  )
  .use(jwt({ name: "jwt", secret: env.JWT_SECRET }))
  .derive(async ({ headers, jwt, set }) => {
    const auth = headers.authorization;
    if (!auth?.startsWith("Bearer ")) return { authUser: null };
    const token = auth.slice("Bearer ".length);
    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      return { authUser: null };
    }
    return { authUser: payload as { sub: string; email: string } };
  })
  .onRequest(({ request }) => {
    // biome-ignore lint/suspicious/noConsole: request logging
    console.info(`${new Date().toISOString()} ${request.method} ${new URL(request.url).pathname}`);
  })
  .onError(({ code, error, set }) => {
    // biome-ignore lint/suspicious/noConsole: error logging
    console.error(code, error);
    const status =
      code === "VALIDATION"
        ? 400
        : error.message.includes("Unauthorized")
          ? 401
          : error.message.includes("Forbidden")
            ? 403
            : 400;
    set.status = status;
    return {
      error: error.message,
      code
    };
  })
  .get("/health", async () => {
    await db`select 1`;
    return { ok: true };
  })
  .get("/setup/status", async () => {
    const hasAdmin = await hasAnyAdmin();
    const schema = await currentSchema();
    const tables = await getTables();
    return {
      hasAdmin,
      schemaInitialized: schema.tables.length > 0,
      tablesCount: tables.length
    };
  })
  .post("/auth/bootstrap", async ({ body, jwt, set }) => {
    const Body = z.object({ email: z.string().email(), password: z.string().min(8) });
    const parsed = Body.parse(body);

    const hasAdmin = await hasAnyAdmin();
    if (hasAdmin) {
      set.status = 409;
      return { error: "Admin already exists" };
    }

    const passwordHash = await hashPassword(parsed.password);
    const rows = await db<{ id: string; email: string }>`
      insert into admin_users (email, password_hash)
      values (${parsed.email.toLowerCase()}, ${passwordHash})
      returning id, email
    `;
    const admin = rows[0]!;
    const token = await jwt.sign({ sub: admin.id, email: admin.email });
    return { token, admin: { id: admin.id, email: admin.email } };
  })
  .post("/auth/login", async ({ body, jwt, set }) => {
    const Body = z.object({ email: z.string().email(), password: z.string().min(1) });
    const parsed = Body.parse(body);

    const rows = await db<{ id: string; email: string; password_hash: string }>`
      select id, email, password_hash
      from admin_users
      where email = ${parsed.email.toLowerCase()}
      limit 1
    `;
    const admin = rows[0];
    if (!admin) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const ok = await verifyPassword(parsed.password, admin.password_hash);
    if (!ok) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const token = await jwt.sign({ sub: admin.id, email: admin.email });
    return { token, admin: { id: admin.id, email: admin.email } };
  })
  .get("/schema", async ({ authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    return currentSchema();
  })
  .post("/schema/apply", async ({ body, authUser }) => {
    if (!authUser) throw new Error("Unauthorized");
    const parsed = ApplySchemaSchema.parse(body);
    return applySchema(parsed.tables);
  })
  .get("/tables", async ({ authUser }) => {
    if (!authUser) throw new Error("Unauthorized");
    const tables = await getTables();
    return { tables };
  })
  .post("/tables", async ({ body, authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    const parsed = TableDefSchema.parse(body);
    await ensurePhysicalTable(parsed);
    await upsertRegistryForSchema([parsed]);
    const schema = await currentSchema();
    const next = {
      ...schema,
      tables: [...schema.tables.filter((t) => t.name !== parsed.name), parsed]
    };
    // Persist updated schema file
    return await applySchema(next.tables);
  })
  .get("/tables/:table/columns", async ({ params, authUser }) => {
    if (!authUser) throw new Error("Unauthorized");
    const cols = await getColumns(params.table);
    return { columns: cols };
  })
  .post("/tables/:table/columns", async ({ params, body, authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    const col = ColumnDefSchema.parse(body);
    const ok = await tableExistsInRegistry(params.table);
    if (!ok) {
      set.status = 404;
      return { error: `Unknown table "${params.table}"` };
    }
    await addPhysicalColumn(params.table, col);
    await upsertRegistryForSchema([{ name: params.table, columns: [col] }]);
    const schema = await currentSchema();
    const existing = schema.tables.find((t) => t.name === params.table);
    const updated = existing
      ? { ...existing, columns: [...existing.columns.filter((c) => c.name !== col.name), col] }
      : { name: params.table, columns: [col] };
    const next = {
      ...schema,
      tables: [...schema.tables.filter((t) => t.name !== params.table), updated].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    };
    return await applySchema(next.tables);
  })
  .get("/data/:table", async ({ params, query, authUser }) => {
    if (!authUser) throw new Error("Unauthorized");
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(query.limit);
    const offset = z.coerce.number().int().min(0).catch(0).parse(query.offset);
    const rows = await listRows(params.table, limit, offset);
    return { rows };
  })
  .get("/data/:table/:id", async ({ params, authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    const row = await getRow(params.table, params.id);
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { row };
  })
  .post("/data/:table", async ({ params, body, authUser }) => {
    if (!authUser) throw new Error("Unauthorized");
    const row = await createRow(params.table, (body ?? {}) as Record<string, unknown>);
    return { row };
  })
  .put("/data/:table/:id", async ({ params, body, authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    const row = await updateRow(params.table, params.id, (body ?? {}) as Record<string, unknown>);
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { row };
  })
  .delete("/data/:table/:id", async ({ params, authUser, set }) => {
    if (!authUser) throw new Error("Unauthorized");
    const row = await deleteRow(params.table, params.id);
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { ok: true };
  });

app.listen(env.PORT);

// biome-ignore lint/suspicious/noConsole: server bootstrap
console.log(`API listening on http://localhost:${env.PORT}`);
