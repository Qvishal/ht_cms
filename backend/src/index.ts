import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { z } from "zod";

import { hashPassword, verifyPassword } from "./auth/password";
import {
  requireAdmin,
  requireAuth,
  requireTableRead,
  requireTableWrite,
} from "./auth/rbac";
import { db } from "./db";
import { loadEnv } from "./env";
import { assertIdent, quoteIdent } from "./lib/ids";
import { migrate } from "./migrations";
import { sqlTypeFor } from "./schema/sql";
import type { ColumnDef } from "./schema/types";
import {
  ApplySchemaSchema,
  ColumnDefSchema,
  TableDefSchema,
} from "./schema/validation";
import {
  createRow,
  getRow,
  listRows,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "./services/crud";
import { listAuditLogs, writeAuditLog } from "./services/audit";
import {
  type AccessType,
  getAccessTypeForUserOnTableName,
  listAllTables,
  listPermissionsForUser,
  listTablesForUser,
  replacePermissionsForUser,
} from "./services/permissions";
import {
  addPhysicalColumn,
  ensurePhysicalTable,
  getColumns,
  getTableInfoByName,
  getTables,
  setColumnActive,
  tableExistsInRegistry,
  updateRegistryColumn,
  upsertRegistryForSchema,
} from "./services/registry";
import { applySchema, currentSchema } from "./services/schemaApply";
import {
  removeColumnFromSchema,
  upsertColumnInSchema,
} from "./services/schemaMutations";
import {
  getVisibilityMode,
  setVisibilityMode,
  type VisibilityMode,
} from "./services/tableMetadata";
import {
  type UserRole,
  countAdmins,
  createUser,
  deleteUserAdmin,
  getUserByEmailForLogin,
  getUserById,
  hasAnyAdmin,
  listUsers,
  setUserRole,
  updateUserAdmin,
} from "./services/users";
import { getRowVersionById, listRowVersions } from "./services/versions";

const env = loadEnv();

await migrate();

const app = new Elysia()
  .use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
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
    const sub = (payload as { sub?: unknown }).sub;
    if (typeof sub !== "string") {
      set.status = 401;
      return { authUser: null };
    }
    const user = await getUserById(sub);
    if (!user) {
      set.status = 401;
      return { authUser: null };
    }
    return { authUser: user };
  })
  .onRequest(({ request }) => {
    console.info(
      `${new Date().toISOString()} ${request.method} ${new URL(request.url).pathname}`,
    );
  })
  .onError(({ code, error, set }) => {
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
      code,
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
      tablesCount: tables.length,
    };
  })
  .get("/me", async ({ authUser }) => {
    requireAuth(authUser);
    return { user: authUser };
  })
  .post("/auth/bootstrap", async ({ body, jwt, set }) => {
    const Body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
    });
    const parsed = Body.parse(body);

    const hasAdmin = await hasAnyAdmin();
    if (hasAdmin) {
      set.status = 409;
      return { error: "Admin already exists" };
    }

    const passwordHash = await hashPassword(parsed.password);
    const admin = await createUser({
      email: parsed.email,
      passwordHash,
      role: "admin",
    });
    // Keep legacy table in sync for older installs/tools.
    await db`
      insert into admin_users (id, email, password_hash)
      values (${admin.id}, ${admin.email.toLowerCase()}, ${passwordHash})
      on conflict (email) do nothing
    `;
    const token = await jwt.sign({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });
    return { token, admin: { id: admin.id, email: admin.email }, user: admin };
  })
  .post("/auth/login", async ({ body, jwt, set }) => {
    const Body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = Body.parse(body);

    const user = await getUserByEmailForLogin(parsed.email);
    if (!user) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const ok = await verifyPassword(parsed.password, user.password_hash);
    if (!ok) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const token = await jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    // Backward compatible: keep `admin` field when the user is an admin.
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      ...(user.role === "admin"
        ? { admin: { id: user.id, email: user.email } }
        : {}),
    };
  })
  .post("/auth/register", async ({ body, jwt, set }) => {
    const Body = z.object({
      email: z.string().email(),
      name: z.string().min(1).max(120).optional(),
      password: z.string().min(8),
    });
    const parsed = Body.parse(body);
    const passwordHash = await hashPassword(parsed.password);
    try {
      const user = await createUser({
        email: parsed.email,
        name: parsed.name,
        passwordHash,
        role: "user",
      });
      const token = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      return { token, user };
    } catch (e) {
      // Likely unique violation on email.
      set.status = 409;
      return {
        error: (e as Error).message.includes("unique")
          ? "Email already in use"
          : "Registration failed",
      };
    }
  })
  .get("/schema", async ({ authUser, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    return currentSchema();
  })
  .post("/schema/apply", async ({ body, authUser }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const parsed = ApplySchemaSchema.parse(body);
    const applied = await applySchema(parsed.tables);
    await writeAuditLog({
      userId: authUser.id,
      actionType: "STRUCTURE_CHANGE",
      tableId: null,
      oldValue: null,
      newValue: { event: "SCHEMA_APPLIED", tables: parsed.tables.map((t) => t.name) },
    });
    return applied;
  })
  .get("/tables", async ({ authUser }) => {
    requireAuth(authUser);
    const tables =
      authUser.role === "admin"
        ? await getTables()
        : await listTablesForUser(authUser.id);
    return { tables };
  })
  .post("/tables", async ({ body, authUser, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const parsed = TableDefSchema.parse(body);
    await ensurePhysicalTable(parsed);
    await upsertRegistryForSchema([parsed]);
    await setVisibilityMode(parsed.name, "GLOBAL_ACCESS");
    const schema = await currentSchema();
    const next = {
      ...schema,
      tables: [...schema.tables.filter((t) => t.name !== parsed.name), parsed],
    };
    // Persist updated schema file
    const applied = await applySchema(next.tables);
    const tableInfo = await getTableInfoByName(parsed.name);
    await writeAuditLog({
      userId: authUser.id,
      actionType: "STRUCTURE_CHANGE",
      tableId: tableInfo?.id ?? null,
      oldValue: null,
      newValue: { event: "TABLE_CREATED", table: parsed.name },
    });
    return applied;
  })
  .get("/tables/:table/columns", async ({ params, authUser }) => {
    requireAuth(authUser);
    await requireTableRead(authUser, params.table);
    // Inactive columns are hidden by default; admins can request them via `?includeInactive=1`.
    const cols = await getColumns(params.table, false);
    return { columns: cols };
  })
  .get("/tables/:table/columns/all", async ({ params, authUser }) => {
    // Backward compatible way for admin UI to fetch inactive columns too.
    requireAuth(authUser);
    requireAdmin(authUser);
    const cols = await getColumns(params.table, true);
    return { columns: cols };
  })
  .put(
    "/tables/:table/columns/:column",
    async ({ params, body, authUser, set }) => {
      requireAuth(authUser);
      requireAdmin(authUser);

      assertIdent(params.table, "table");
      assertIdent(params.column, "column");

      const reserved = new Set([
        "id",
        "created_at",
        "updated_at",
        "created_by",
        "is_deleted",
        "deleted_at",
      ]);
      if (reserved.has(params.column)) {
        set.status = 400;
        return { error: `Column "${params.column}" is reserved` };
      }

      const Body = z.object({
        type: z
          .enum(["string", "text", "number", "boolean", "date", "json"])
          .optional(),
        required: z.boolean().optional(),
        active: z.boolean().optional(),
      });
      const parsed = Body.parse(body);

      const existing = (await getColumns(params.table, true)).find(
        (c) => c.name === params.column,
      );
      if (!existing) {
        set.status = 404;
        return { error: "Column not found" };
      }

      // If type changed, attempt a transactional ALTER COLUMN so DB + registry stay consistent.
      if (parsed.type && parsed.type !== existing.type) {
        const tableIdent = quoteIdent(params.table);
        const colIdent = quoteIdent(params.column);
        const nextSqlType = sqlTypeFor(parsed.type);
        try {
          await db.unsafe(
            `alter table ${tableIdent} alter column ${colIdent} type ${nextSqlType} using ${colIdent}::${nextSqlType};`,
          );
        } catch (e) {
          set.status = 400;
          return { error: `Failed to change type: ${(e as Error).message}` };
        }
      }

      const ok = await updateRegistryColumn(params.table, params.column, {
        type: parsed.type,
        required: parsed.required,
        active: parsed.active,
      });
      if (!ok) {
        set.status = 404;
        return { error: "Column not found" };
      }

      const tableInfo = await getTableInfoByName(params.table);
      await writeAuditLog({
        userId: authUser.id,
        actionType: "STRUCTURE_CHANGE",
        tableId: tableInfo?.id ?? null,
        oldValue: {
          column: params.column,
          type: existing.type,
          required: existing.required,
          active: existing.active !== false,
        },
        newValue: {
          column: params.column,
          type: parsed.type ?? existing.type,
          required: parsed.required ?? existing.required,
          active: parsed.active ?? (existing.active !== false),
        },
      });

      // Keep schema file in sync (best-effort).
      try {
        if (parsed.active === false) {
          await removeColumnFromSchema(params.table, params.column);
        } else {
          const nextType =
            (parsed.type ?? existing.type) === "json"
              ? "text"
              : (parsed.type ?? existing.type);
          await upsertColumnInSchema(params.table, {
            name: params.column,
            type: nextType as ColumnDef["type"],
            required: parsed.required ?? existing.required,
          });
        }
      } catch {
        // Ignore schema file write errors; DB remains the runtime source of truth.
      }

      return { ok: true };
    },
  )
  .delete(
    "/tables/:table/columns/:column",
    async ({ params, authUser, set }) => {
      requireAuth(authUser);
      requireAdmin(authUser);

      assertIdent(params.table, "table");
      assertIdent(params.column, "column");

      const reserved = new Set([
        "id",
        "created_at",
        "updated_at",
        "created_by",
        "is_deleted",
        "deleted_at",
      ]);
      if (reserved.has(params.column)) {
        set.status = 400;
        return { error: `Column "${params.column}" is reserved` };
      }

      const ok = await setColumnActive(params.table, params.column, false);
      if (!ok) {
        set.status = 404;
        return { error: "Column not found" };
      }

      const tableInfo = await getTableInfoByName(params.table);
      await writeAuditLog({
        userId: authUser.id,
        actionType: "STRUCTURE_CHANGE",
        tableId: tableInfo?.id ?? null,
        oldValue: { column: params.column, active: true },
        newValue: { column: params.column, active: false },
      });

      try {
        await removeColumnFromSchema(params.table, params.column);
      } catch {
        // Ignore schema file write errors.
      }

      return { ok: true };
    },
  )
  .get("/tables/:table/access", async ({ params, authUser }) => {
    requireAuth(authUser);
    if (authUser.role !== "admin") {
      await requireTableRead(authUser, params.table);
    }
    const access =
      authUser.role === "admin"
        ? ("write" as const)
        : await getAccessTypeForUserOnTableName(authUser.id, params.table);
    const visibilityMode = await getVisibilityMode(params.table);
    return {
      accessType: access,
      canInsert: authUser.role === "admin" || access === "write",
      canUpdate: authUser.role === "admin" || access === "write",
      canDelete: authUser.role === "admin" || access === "write",
      canAlter: authUser.role === "admin",
      visibilityMode,
    };
  })
  .put("/tables/:table/visibility", async ({ params, body, authUser, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const Body = z.object({
      visibilityMode: z.enum(["GLOBAL_ACCESS", "USER_SCOPED"]),
    });
    const parsed = Body.parse(body);
    const tableInfo = await getTableInfoByName(params.table);
    if (!tableInfo) {
      set.status = 404;
      return { error: "Table not found" };
    }
    const prev = await getVisibilityMode(params.table);
    await setVisibilityMode(
      params.table,
      parsed.visibilityMode as VisibilityMode,
    );
    await writeAuditLog({
      userId: authUser.id,
      actionType: "STRUCTURE_CHANGE",
      tableId: tableInfo.id,
      oldValue: { visibilityMode: prev },
      newValue: { visibilityMode: parsed.visibilityMode },
    });
    return { ok: true, visibilityMode: parsed.visibilityMode };
  })
  .post("/tables/:table/columns", async ({ params, body, authUser, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
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
      ? {
          ...existing,
          columns: [
            ...existing.columns.filter((c) => c.name !== col.name),
            col,
          ],
        }
      : { name: params.table, columns: [col] };
    const next = {
      ...schema,
      tables: [
        ...schema.tables.filter((t) => t.name !== params.table),
        updated,
      ].sort((a, b) => a.name.localeCompare(b.name)),
    };
    const applied = await applySchema(next.tables);
    const tableInfo = await getTableInfoByName(params.table);
    await writeAuditLog({
      userId: authUser.id,
      actionType: "STRUCTURE_CHANGE",
      tableId: tableInfo?.id ?? null,
      oldValue: null,
      newValue: { event: "COLUMN_ADDED", table: params.table, column: col },
    });
    return applied;
  })
  .get("/data/:table", async ({ params, query, authUser }) => {
    requireAuth(authUser);
    await requireTableRead(authUser, params.table);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .catch(50)
      .parse(query.limit);
    const offset = z.coerce.number().int().min(0).catch(0).parse(query.offset);
    const includeDeleted =
      authUser.role === "admin" && String(query.includeDeleted ?? "") === "1";
    const visibilityMode = await getVisibilityMode(params.table);
    const rows = await listRows(params.table, limit, offset, {
      userId: authUser.id,
      isAdmin: authUser.role === "admin",
      visibilityMode,
      includeDeleted,
    });
    return { rows };
  })
  .get("/data/:table/:id", async ({ params, query, authUser, set }) => {
    requireAuth(authUser);
    await requireTableRead(authUser, params.table);
    const visibilityMode = await getVisibilityMode(params.table);
    const includeDeleted =
      authUser.role === "admin" && String(query.includeDeleted ?? "") === "1";
    const row = await getRow(params.table, params.id, {
      userId: authUser.id,
      isAdmin: authUser.role === "admin",
      visibilityMode,
      includeDeleted,
    });
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { row };
  })
  .post("/data/:table", async ({ params, body, authUser }) => {
    requireAuth(authUser);
    await requireTableWrite(authUser, params.table);
    const visibilityMode = await getVisibilityMode(params.table);
    const row = await createRow(
      params.table,
      (body ?? {}) as Record<string, unknown>,
      {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
      },
    );
    return { row };
  })
  .put("/data/:table/:id", async ({ params, body, authUser, set }) => {
    requireAuth(authUser);
    await requireTableWrite(authUser, params.table);
    const visibilityMode = await getVisibilityMode(params.table);
    const row = await updateRow(
      params.table,
      params.id,
      (body ?? {}) as Record<string, unknown>,
      {
        userId: authUser.id,
        isAdmin: authUser.role === "admin",
        visibilityMode,
      },
    );
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { row };
  })
  .delete("/data/:table/:id", async ({ params, authUser, set }) => {
    requireAuth(authUser);
    await requireTableWrite(authUser, params.table);
    const visibilityMode = await getVisibilityMode(params.table);
    const row = await softDeleteRow(params.table, params.id, {
      userId: authUser.id,
      isAdmin: authUser.role === "admin",
      visibilityMode,
    });
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { ok: true };
  })
  .post("/data/:table/:id/restore", async ({ params, authUser, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const row = await restoreRow(params.table, params.id, {
      userId: authUser.id,
      isAdmin: true,
      visibilityMode: "GLOBAL_ACCESS",
      includeDeleted: true,
    });
    if (!row) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { row };
  })
  // Admin APIs
  .get("/admin/users", async ({ authUser }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const users = await listUsers();
    return { users };
  })
  .post("/admin/users", async ({ authUser, body, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const Body = z.object({
      email: z.string().email(),
      name: z.string().min(1).max(120).optional(),
      password: z.string().min(8),
      role: z.enum(["admin", "user"]).optional(),
    });
    const parsed = Body.parse(body);
    const passwordHash = await hashPassword(parsed.password);
    try {
      const user = await createUser({
        email: parsed.email,
        name: parsed.name,
        passwordHash,
        role: (parsed.role ?? "user") as UserRole,
      });
      return { user };
    } catch (e) {
      set.status = 409;
      return {
        error: (e as Error).message.includes("unique")
          ? "Email already in use"
          : "Failed to create user",
      };
    }
  })
  .put("/admin/users/:id", async ({ authUser, params, body, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);

    const Body = z.object({
      email: z.string().email().optional(),
      name: z.string().min(1).max(120).nullable().optional(),
      password: z.string().min(8).optional(),
    });
    const parsed = Body.parse(body);

    if (
      params.id === authUser.id &&
      parsed.email &&
      parsed.email.toLowerCase() !== authUser.email.toLowerCase()
    ) {
      set.status = 400;
      return { error: "Cannot change your own email from this screen" };
    }

    const passwordHash = parsed.password
      ? await hashPassword(parsed.password)
      : undefined;
    try {
      const user = await updateUserAdmin({
        userId: params.id,
        email: parsed.email,
        name: parsed.name,
        passwordHash,
      });
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Best-effort sync to legacy table if the user is an admin and exists there.
      if (user.role === "admin") {
        await db`
          update admin_users
          set
            email = ${user.email.toLowerCase()},
            password_hash = coalesce(${passwordHash ?? null}, password_hash)
          where id = ${user.id}
        `;
      }

      return { user };
    } catch (e) {
      set.status = 409;
      return {
        error: (e as Error).message.includes("unique")
          ? "Email already in use"
          : "Failed to update user",
      };
    }
  })
  .delete("/admin/users/:id", async ({ authUser, params, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);

    if (params.id === authUser.id) {
      set.status = 400;
      return { error: "You cannot delete your own account" };
    }

    const user = await getUserById(params.id);
    if (!user) {
      set.status = 404;
      return { error: "User not found" };
    }

    if (user.role === "admin") {
      const admins = await countAdmins();
      if (admins <= 1) {
        set.status = 400;
        return { error: "Cannot delete the last admin" };
      }
    }

    const ok = await deleteUserAdmin(params.id);
    if (!ok) {
      set.status = 404;
      return { error: "User not found" };
    }

    // Best-effort cleanup of legacy table.
    await db`delete from admin_users where id = ${params.id}`;

    return { ok: true };
  })
  .put("/admin/users/:id/role", async ({ authUser, params, body, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const Body = z.object({ role: z.enum(["admin", "user"]) });
    const parsed = Body.parse(body);
    // Prevent demoting the last admin (keeps the project recoverable).
    if (parsed.role === "user") {
      const admins = await countAdmins();
      if (admins <= 1) {
        set.status = 400;
        return { error: "Cannot demote the last admin" };
      }
    }
    const user = await setUserRole(params.id, parsed.role as UserRole);
    if (!user) {
      set.status = 404;
      return { error: "User not found" };
    }
    return { user };
  })
  .get("/admin/tables", async ({ authUser }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const tables = await listAllTables();
    return { tables };
  })
  .get("/admin/users/:id/permissions", async ({ authUser, params, set }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const user = await getUserById(params.id);
    if (!user) {
      set.status = 404;
      return { error: "User not found" };
    }
    const permissions = await listPermissionsForUser(params.id);
    return { user, permissions };
  })
  .put(
    "/admin/users/:id/permissions",
    async ({ authUser, params, body, set }) => {
      requireAuth(authUser);
      requireAdmin(authUser);
      const Body = z.object({
        permissions: z
          .array(
            z.object({
              tableId: z.string().uuid(),
              accessType: z.enum(["read", "write"]),
            }),
          )
          .default([]),
      });
      const parsed = Body.parse(body);
      const user = await getUserById(params.id);
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }
      const before = await listPermissionsForUser(params.id);
      await replacePermissionsForUser(
        params.id,
        parsed.permissions.map((p) => ({
          tableId: p.tableId,
          accessType: p.accessType as AccessType,
        })),
      );
      await writeAuditLog({
        userId: authUser.id,
        actionType: "PERMISSION_CHANGE",
        tableId: null,
        oldValue: { userId: params.id, permissions: before },
        newValue: { userId: params.id, permissions: parsed.permissions },
      });
      return { ok: true };
    },
  );

app
  .get("/admin/audit-logs", async ({ authUser, query }) => {
    requireAuth(authUser);
    requireAdmin(authUser);
    const Query = z.object({
      userId: z.string().uuid().optional(),
      tableId: z.string().uuid().optional(),
      actionType: z
        .enum([
          "CREATE",
          "UPDATE",
          "DELETE",
          "STRUCTURE_CHANGE",
          "PERMISSION_CHANGE",
        ])
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).catch(50),
      offset: z.coerce.number().int().min(0).catch(0),
    });
    const parsed = Query.parse(query);
    const logs = await listAuditLogs({
      userId: parsed.userId,
      tableId: parsed.tableId,
      actionType: parsed.actionType,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return { logs };
  })
  .get(
    "/admin/tables/:table/rows/:id/versions",
    async ({ authUser, params, set }) => {
      requireAuth(authUser);
      requireAdmin(authUser);
      const tableInfo = await getTableInfoByName(params.table);
      if (!tableInfo) {
        set.status = 404;
        return { error: "Table not found" };
      }
      const versions = await listRowVersions({
        tableId: tableInfo.id,
        rowId: params.id,
      });
      return { versions };
    },
  )
  .post(
    "/admin/tables/:table/rows/:id/restore-version",
    async ({ authUser, params, body, set }) => {
      requireAuth(authUser);
      requireAdmin(authUser);
      const Body = z.object({ versionId: z.string().uuid() });
      const parsed = Body.parse(body);
      const tableInfo = await getTableInfoByName(params.table);
      if (!tableInfo) {
        set.status = 404;
        return { error: "Table not found" };
      }
      const version = await getRowVersionById({
        tableId: tableInfo.id,
        versionId: parsed.versionId,
      });
      if (!version || version.row_id !== params.id) {
        set.status = 404;
        return { error: "Version not found" };
      }
      if (!version.data || typeof version.data !== "object") {
        set.status = 400;
        return { error: "Invalid version payload" };
      }
      const next = await updateRow(
        params.table,
        params.id,
        version.data as Record<string, unknown>,
        {
          userId: authUser.id,
          isAdmin: true,
          visibilityMode: "GLOBAL_ACCESS",
        },
      );
      if (!next) {
        set.status = 404;
        return { error: "Row not found" };
      }
      return { row: next };
    },
  );

app.listen(env.PORT);

console.log(`API listening on http://localhost:${env.PORT}`);
