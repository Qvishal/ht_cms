# AGENTS.md — HT CMS Agent Instructions

> This document provides operational context, architectural guidance, and behavioral rules for any AI agent
> (Copilot, Antigravity, Claude, Cursor, etc.) working on the **ht_cms** codebase.
> Read this file completely before writing, refactoring, or reviewing any code in this repository.

---

## 1. Project Overview

**HT CMS** is a production-ready, security-hardened headless CMS with a dynamic schema system.

| Layer      | Technology                                                  | Port (local)                     |
| ---------- | ----------------------------------------------------------- | -------------------------------- |
| Frontend   | Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui | `:3000`                          |
| Backend    | Bun · Elysia · TypeScript · Zod                             | `:4000` (HTTP) / `:4433` (HTTPS) |
| Database   | PostgreSQL 16 **or** MySQL 8 (both available via Docker)    | PG: `:5432` / MySQL: `:3307`     |
| Cache      | Redis 7 (rate limiting, session, query cache)               | `:6379`                          |
| HTTP Cache | Varnish 7 (optional, CDN-style edge cache)                  | `:6081`                          |

The canonical dev launcher is **`./dev.sh`** (starts Docker, waits for DBs, then runs backend + frontend concurrently).

---

## 2. Repository Structure

```
ht_cms/
├── backend/                   # Bun/Elysia API server
│   ├── src/
│   │   ├── index.ts           # 🔑 Main entry point — all routes defined here (~1600 lines)
│   │   ├── env.ts             # Zod-validated env schema (single source of truth for config)
│   │   ├── db.ts              # Database adapter (postgres.js + mysql2, dialect-aware)
│   │   ├── migrations.ts      # Idempotent migrations for Postgres AND MySQL
│   │   ├── auth/
│   │   │   ├── password.ts    # bcrypt helpers
│   │   │   └── rbac.ts        # requireAuth / requireAdmin / requireTableRead / requireTableWrite
│   │   ├── lib/
│   │   │   ├── ids.ts         # assertIdent() / quoteIdent() — SQL injection guards
│   │   │   ├── encryption.ts  # AES-256-GCM payload encryption (server-side)
│   │   │   ├── cacheKeys.ts   # Structured Redis key builders
│   │   │   └── uuid.ts        # UUID helper
│   │   ├── middleware/
│   │   │   └── cacheInvalidation.ts  # Elysia middleware: auto-invalidate on mutations
│   │   ├── routes/
│   │   │   ├── swaggerDynamic.ts     # Dynamic Swagger docs per registered table
│   │   │   └── dynamicApiRoutes.example.ts  # Example pattern for per-table routes
│   │   ├── schema/
│   │   │   ├── store.ts       # schema.json read/write helpers
│   │   │   ├── sql.ts         # sqlTypeFor() — ColumnDef type → SQL type mapping
│   │   │   ├── types.ts       # ColumnDef TypeScript types
│   │   │   └── validation.ts  # Zod schemas for schema API payloads
│   │   └── services/
│   │       ├── audit.ts       # writeAuditLog / listAuditLogs
│   │       ├── caching.ts     # Redis cache service (sessions, RBAC, query cache, rate limit)
│   │       ├── crud.ts        # createRow / getRow / listRows / softDeleteRow / hardDeleteRow / restoreRow / updateRow
│   │       ├── dynamicApi.ts  # Dynamic per-table API route builder
│   │       ├── dynamicValidation.ts  # Runtime payload validation against cms_columns
│   │       ├── permissions.ts # Per-user table access: read / write
│   │       ├── registry.ts    # cms_tables + cms_columns registry helpers
│   │       ├── schemaApply.ts # Orchestrates schema application (validate → DDL → registry → file)
│   │       ├── schemaMutations.ts  # Atomic schema.json patch helpers
│   │       ├── tableMetadata.ts    # Visibility mode (GLOBAL_ACCESS / USER_SCOPED)
│   │       ├── users.ts       # CRUD for users table (admin + regular)
│   │       └── versions.ts    # Row version history
│   ├── config/
│   │   └── varnish.vcl        # Varnish cache configuration
│   ├── uploads/               # Auth-guarded image storage (served by /uploads/:filename)
│   ├── .env.example           # Copy → .env and fill in secrets
│   ├── biome.json             # Linter + formatter config (Biome)
│   └── package.json           # Scripts: dev, start, lint, format
│
├── frontend/                  # Next.js Admin Panel
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx     # Root layout (theme, service worker)
│   │   │   ├── page.tsx       # Root redirect (→ /dashboard or /login)
│   │   │   ├── login/         # Login page
│   │   │   ├── register/      # User registration page
│   │   │   ├── setup/         # Setup wizard (bootstrap admin + define schema)
│   │   │   ├── offline/       # PWA offline fallback
│   │   │   ├── api/           # Next.js API routes (server-side proxying if needed)
│   │   │   └── dashboard/
│   │   │       ├── layout.tsx # Dashboard shell (sidebar, nav, auth guard)
│   │   │       ├── page.tsx   # Dashboard home (stats, table list)
│   │   │       ├── [table]/   # Dynamic per-table data CRUD pages
│   │   │       └── admin/
│   │   │           ├── users/ # User management (admin only)
│   │   │           └── audit-logs/  # Audit log viewer (admin only)
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui primitive components
│   │   │   ├── HealthCheck.tsx
│   │   │   ├── rich-text-editor.tsx
│   │   │   ├── theme-toggle.tsx
│   │   │   └── ServiceWorkerRegister.tsx
│   │   └── lib/
│   │       ├── api.ts         # Fetch wrapper (auth headers, ALE encryption, gzip)
│   │       ├── auth.ts        # Token get/set/clear (localStorage)
│   │       ├── encryption.ts  # AES-256-GCM payload encryption (client-side, Web Crypto API)
│   │       ├── session.tsx    # Session context provider
│   │       ├── theme.tsx      # Dark/light theme context
│   │       ├── safe-router.ts # Graceful Next.js router wrapper
│   │       └── utils.ts       # Tailwind cn() helper
│   ├── .env.example           # Copy → .env.local
│   └── package.json
│
├── database/
│   └── docker-compose.yml     # Postgres 16 + MySQL 8 + Redis 7 + Varnish 7
│
├── schema/
│   └── schema.json            # Generated schema file (source of truth for UI/validation)
│
├── dev.sh                     # One-command dev launcher
└── README.md
```

---

## 3. Core Architecture Concepts

### 3.1 Dual-Database Design

The backend supports **both PostgreSQL and MySQL 8** simultaneously via the `DB_DIALECT` env var.

- **Default**: `DB_DIALECT=mysql` (MySQL 8, port 3307)
- `DB_DIALECT=postgres` uses `DATABASE_URL` (postgres.js driver)
- `DB_DIALECT=mysql` uses `MYSQL_URL` (mysql2 driver)
- All migrations, CRUD, and DDL operations have **dialect-aware branches** — never write
  raw SQL that only works for one dialect without providing the other.
- Use `dbDialect === "mysql"` checks and `db.unsafe(...)` for DDL; `sql\`...\`` tagged template for safe queries.

### 3.2 Dynamic Schema System

The schema system is the heart of the CMS:

1. **`schema/schema.json`** — persisted on disk; source of truth for table/column definitions
2. **`cms_tables` + `cms_columns`** — runtime registry in the database
3. **Physical tables** — actual user-defined tables created via DDL
4. Applying a schema is always **transactional**: validate → create DDL → update registry → persist JSON
5. When editing schema-related code always keep all three layers in sync.

### 3.3 RBAC & Permissions

- Two roles: `admin` (full access) and `user` (per-table read/write grants)
- Helpers in `src/auth/rbac.ts`: `requireAuth`, `requireAdmin`, `requireTableRead`, `requireTableWrite`
- Per-table permissions stored in `table_permissions` (user_id + table_id + access_type)
- Tables have a `visibility_mode`: `GLOBAL_ACCESS` (all authenticated users can read) or `USER_SCOPED` (explicit grants only)
- Always call the appropriate `require*` guard at the top of every route handler.

### 3.4 Application-Level Encryption (ALE)

- **AES-256-GCM** with per-message IVs
- Enabled via `ENCRYPT_PAYLOADS=true` + `PAYLOAD_ENCRYPTION_KEY` (64-char hex = 32 bytes)
- Backend: `src/lib/encryption.ts` (encrypt/decrypt with Node Crypto)
- Frontend: `src/lib/encryption.ts` (encrypt/decrypt with Web Crypto API)
- The `x-payload-encrypted: true` header flags encrypted requests/responses
- The `/upload` route is **always excluded** from encryption (multipart)
- When adding new POST/PUT routes, ensure they are compatible with the encryption middleware

### 3.5 Caching Architecture (HYBRID)

Three caching strategies selectable via `CACHE_STRATEGY`:

- `HYBRID` (default): Redis for sessions/RBAC + Varnish for public API
- `REDIS_ONLY`: Redis only, no Varnish
- `DISABLED`: No caching

TTLs (configured in `index.ts`):
| Cache type | TTL |
| ----------- | -------- |
| Query lists | 5 min |
| Single row | 15 min |
| Session | 24 hours |
| RBAC | 1 hour |
| Stats | 5 min |

Always call `caching.invalidateTableCache(tableName)` after any mutation to a CMS-managed table.

### 3.6 Security Headers

Every response includes hardened headers set in the `onAfterHandle` global hook in `index.ts`:

- `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`
- `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`
- `Strict-Transport-Security` (when `FORCE_HTTPS=true`)
- Do **not** remove or weaken these headers.

### 3.7 Soft Deletes & Row Versioning

- All user-created tables automatically receive `created_by`, `is_deleted`, `deleted_at` governance columns (added by `ensureGovernanceFields*` in migrations)
- `DELETE /data/:table/:id` performs a **soft delete** (`is_deleted = true`)
- Use `hardDeleteRow` only when explicitly required
- Row versions are tracked in `row_versions` on every UPDATE

---

## 4. API Reference

All routes are defined in `backend/src/index.ts`. The Swagger UI is available at `http://localhost:4000/swagger`.

### Auth

| Method | Path              | Auth   | Notes                                            |
| ------ | ----------------- | ------ | ------------------------------------------------ |
| POST   | `/auth/bootstrap` | None   | One-time admin creation (errors if admin exists) |
| POST   | `/auth/login`     | None   | Rate limited: 5 attempts / 15 min per IP         |
| POST   | `/auth/register`  | None   | Creates a `user` role account                    |
| GET    | `/me`             | Bearer | Returns current user                             |

### Setup & Schema

| Method | Path            | Auth  | Notes                          |
| ------ | --------------- | ----- | ------------------------------ |
| GET    | `/setup/status` | None  | Check if admin + schema exist  |
| GET    | `/schema`       | Admin | Returns current schema.json    |
| POST   | `/schema/apply` | Admin | Apply full schema (idempotent) |

### Tables & Columns

| Method | Path                             | Auth  | Notes                         |
| ------ | -------------------------------- | ----- | ----------------------------- |
| GET    | `/tables`                        | Auth  | Lists tables (role-filtered)  |
| POST   | `/tables`                        | Admin | Create a new table            |
| GET    | `/tables/:table/columns`         | Auth  | Active columns only           |
| GET    | `/tables/:table/columns/all`     | Admin | All columns incl. inactive    |
| PUT    | `/tables/:table/columns/:column` | Admin | Update type/required/active   |
| DELETE | `/tables/:table/columns/:column` | Admin | Soft-deactivates column       |
| GET    | `/tables/:table/access`          | Auth  | RBAC + visibility info        |
| PUT    | `/tables/:table/visibility`      | Admin | Set GLOBAL_ACCESS/USER_SCOPED |

### Data (Dynamic CRUD)

| Method | Path                           | Auth  | Notes                           |
| ------ | ------------------------------ | ----- | ------------------------------- |
| GET    | `/data/:table`                 | Auth  | List rows (pagination, filters) |
| GET    | `/data/:table/:id`             | Auth  | Single row                      |
| POST   | `/data/:table`                 | Auth  | Create row (ALE encrypted)      |
| PUT    | `/data/:table/:id`             | Auth  | Update row (ALE encrypted)      |
| DELETE | `/data/:table/:id`             | Auth  | Soft delete                     |
| POST   | `/data/:table/:id/restore`     | Admin | Restore soft-deleted row        |
| DELETE | `/data/:table/:id/hard`        | Admin | Permanent delete                |
| GET    | `/data/:table/:id/versions`    | Auth  | Row version history             |
| GET    | `/data/:table/:id/versions/:v` | Auth  | Specific version                |

### Users & Permissions (Admin)

| Method | Path                     | Auth  |
| ------ | ------------------------ | ----- |
| GET    | `/users`                 | Admin |
| POST   | `/users`                 | Admin |
| PUT    | `/users/:id`             | Admin |
| DELETE | `/users/:id`             | Admin |
| GET    | `/users/:id/permissions` | Admin |
| PUT    | `/users/:id/permissions` | Admin |

### Uploads

| Method | Path                 | Auth | Notes                                    |
| ------ | -------------------- | ---- | ---------------------------------------- |
| POST   | `/upload`            | Auth | Multipart; allowed: jpg/png/gif/webp/svg |
| GET    | `/uploads/:filename` | Auth | Supports `?token=` query param           |

### Misc

| Method | Path           | Auth  |
| ------ | -------------- | ----- |
| GET    | `/health`      | None  |
| GET    | `/audit-logs`  | Admin |
| GET    | `/cache/stats` | Admin |
| DELETE | `/cache/clear` | Admin |

---

## 5. Environment Variables

### Backend (`backend/.env`)

| Variable                 | Required | Default                  | Notes                                  |
| ------------------------ | -------- | ------------------------ | -------------------------------------- |
| `PORT`                   | No       | `4000`                   | HTTP port                              |
| `HTTPS_PORT`             | No       | `4433`                   | HTTPS port (native Bun TLS)            |
| `NODE_ENV`               | No       | `development`            | `development` / `production`           |
| `DB_DIALECT`             | No       | `mysql`                  | `postgres` or `mysql`                  |
| `DATABASE_URL`           | Cond.    | —                        | Required when `DB_DIALECT=postgres`    |
| `MYSQL_URL`              | Cond.    | —                        | Required when `DB_DIALECT=mysql`       |
| `REDIS_URL`              | No       | `redis://127.0.0.1:6379` | Redis connection URL                   |
| `JWT_SECRET`             | **Yes**  | —                        | Min 32 chars in production             |
| `FRONTEND_ORIGIN`        | No       | `http://localhost:3000`  | CORS allowed origin                    |
| `CACHE_STRATEGY`         | No       | `HYBRID`                 | `HYBRID` / `REDIS_ONLY` / `DISABLED`   |
| `CACHE_PUBLIC_ONLY`      | No       | `true`                   | Only cache public endpoints in Varnish |
| `VARNISH_HOST`           | No       | `localhost:6081`         | Varnish endpoint for cache purges      |
| `FORCE_HTTPS`            | No       | `false`                  | Redirect HTTP → HTTPS                  |
| `SSL_CERT_PATH`          | Cond.    | —                        | Path to TLS cert (native Bun TLS mode) |
| `SSL_KEY_PATH`           | Cond.    | —                        | Path to TLS key (native Bun TLS mode)  |
| `ENCRYPT_PAYLOADS`       | No       | `false`                  | Enable AES-256-GCM payload encryption  |
| `PAYLOAD_ENCRYPTION_KEY` | Cond.    | —                        | 64-char hex string (32 bytes)          |

### Frontend (`frontend/.env.local`)

| Variable                             | Default                 |
| ------------------------------------ | ----------------------- |
| `NEXT_PUBLIC_API_URL`                | `http://localhost:4000` |
| `NEXT_PUBLIC_ENCRYPT_PAYLOADS`       | `false`                 |
| `NEXT_PUBLIC_PAYLOAD_ENCRYPTION_KEY` | —                       |

---

## 6. Database Schema (System Tables)

```
admin_users        — legacy admin table (kept for backwards compat)
users              — all users (admin + user role)
cms_tables         — registered CMS table definitions
cms_columns        — registered column definitions per table
table_metadata     — per-table visibility_mode (GLOBAL_ACCESS / USER_SCOPED)
table_permissions  — user_id ↔ table_id access grants (read / write)
audit_logs         — STRUCTURE_CHANGE, CREATE, UPDATE, DELETE, PERMISSION_CHANGE events
row_versions       — full JSON snapshot of each row on every UPDATE
```

Supported column types: `string`, `text`, `number`, `boolean`, `date`, `image`
(Note: `json` type is migrated to `text` automatically — do not use `json` as a new column type)

Reserved column names (cannot be used in user-defined columns):
`id`, `created_at`, `updated_at`, `created_by`, `is_deleted`, `deleted_at`

---

## 7. Development Commands

```bash
# Start everything (recommended)
./dev.sh

# Backend only
cd backend && bun run dev        # Watch mode
cd backend && bun run start      # Production mode
cd backend && bun run lint       # Biome linter
cd backend && bun run format     # Biome formatter (auto-fix)

# Frontend only
cd frontend && npm run dev       # Next.js dev server
cd frontend && npm run build     # Production build
cd frontend && npm run lint      # ESLint

# Database
cd database && docker-compose up -d     # Start all services
cd database && docker-compose down      # Stop all services
cd database && docker-compose down -v   # Stop + wipe volumes (DESTRUCTIVE)
```

---

## 8. Agent Rules & Constraints

### 8.1 Code Quality

- **TypeScript strict mode** is enforced. Never use `any` without a comment explaining why.
- Run `bun run lint` (backend) and `npm run lint` (frontend) before declaring a task complete.
- All new backend code must be formatted with **Biome** (`bun run format`).
- All new frontend code must follow the existing Tailwind + shadcn/ui patterns.

### 8.2 SQL Safety

- **NEVER** interpolate user-controlled strings directly into SQL.
- Always use `assertIdent(name, "table"|"column")` before using a name in DDL.
- Always use `quoteIdent(name)` to safely quote identifiers in raw SQL strings.
- Use the `sql\`...\`` tagged template for all parameterized queries.
- For raw DDL (CREATE TABLE, ALTER TABLE, etc.) use `db.unsafe(...)` — acceptable for DDL only.

### 8.3 Dual-Dialect Compatibility

- Every SQL change must work for **both** PostgreSQL and MySQL 8.
- Use `if (dbDialect === "mysql") { ... } else { ... }` pattern when dialects differ.
- Common differences:
  - PostgreSQL uses `$1, $2` placeholders; MySQL uses `?` (handled by the db adapter)
  - PostgreSQL: `gen_random_uuid()`, `bigserial`, `timestamptz`, `jsonb`, `ON CONFLICT`
  - MySQL: `uuid()`, `bigint auto_increment`, `timestamp`, `json`, `INSERT IGNORE`
  - PostgreSQL: `ALTER COLUMN ... TYPE ... USING`; MySQL: `MODIFY COLUMN`
  - PostgreSQL: `CREATE INDEX IF NOT EXISTS`; MySQL: no `IF NOT EXISTS` on index creation (use try/catch)

### 8.4 Security Rules

- Never remove or bypass the `require*` auth guards in route handlers.
- Never disable or weaken security headers in `onAfterHandle`.
- Never expose the `password_hash` field in any API response.
- The `/upload` route must remain isolated from the global encryption middleware.
- File uploads: only allow `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`. Never trust original filenames.
- Always sanitize filenames before serving from `/uploads/` (strip path traversal).
- `JWT_SECRET` must be at least 32 chars in production. Block startup if weak.
- Rate limiting on `/auth/login` must not be removed.

### 8.5 Schema & Migration Rules

- All migrations must be **idempotent** (safe to re-run on existing installs).
- Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` (Postgres), or `INSERT IGNORE` / `try/catch` (MySQL).
- Never write a destructive migration (no DROP TABLE, no DROP COLUMN without admin approval).
- When adding a new system table, add migration code to **both** `migrateMysql()` and `migratePostgres()`.
- When changing schema structure, always update all three layers: DB DDL, registry (`cms_columns`/`cms_tables`), and `schema/schema.json`.

### 8.6 Caching Rules

- After any CREATE, UPDATE, or DELETE on a user-managed table, call `caching.invalidateTableCache(tableName)`.
- After any permission change, call `caching.invalidateUserRBAC(userId)`.
- The cache service degrades gracefully — Redis unavailability must never crash the API.
- Do not cache sensitive data (password hashes, tokens) in query result caches.

### 8.7 Frontend Rules

- The frontend communicates with the backend **only** through `src/lib/api.ts` helpers (`apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiPostFile`).
- Never call `fetch()` directly in page/component code — always use the api helpers.
- Authentication token is stored in `localStorage` via `src/lib/auth.ts`. Never store it elsewhere.
- Protected pages must verify auth via the dashboard `layout.tsx` auth guard.
- Use existing shadcn/ui components from `src/components/ui/` — do not install new UI libraries without discussion.
- Dark mode is handled by `src/lib/theme.tsx` — use `ThemeProvider` and CSS variables.

### 8.8 Adding New Features

When adding a new API endpoint:

1. Define the route in `backend/src/index.ts` (or a dedicated route file if large)
2. Add appropriate `require*` auth guards
3. Add Zod schema validation for the request body
4. Write SQL using dialect-aware pattern
5. Add cache invalidation if mutating data
6. Log to `audit_logs` if it's a structural or sensitive change
7. Update Swagger docs (auto-generated via `@elysiajs/swagger`)

When adding a new frontend page:

1. Create the page under `frontend/src/app/`
2. Place inside `dashboard/` if it requires auth (inherits auth guard from layout)
3. Use `apiGet`/`apiPost` etc. from `src/lib/api.ts`
4. Use shadcn/ui components and existing Tailwind classes
5. Handle loading states and errors with toast notifications (sonner)

---

## 9. Known Patterns & Gotchas

- **`db.unsafe()` vs `sql\`\``**: Use `sql\`\``for all queries with user data (parameterized). Use`db.unsafe()`for DDL only and only after`assertIdent`+`quoteIdent` guards.
- **Schema file vs DB**: The `schema/schema.json` file is a UI/validation cache. The DB (`cms_columns`) is the runtime authority. On conflict, DB wins — the schema file is always regenerated from DB on `POST /schema/apply`.
- **`json` column type is deprecated**: It was migrated to `text`. Do not reintroduce it. Use `text` for large string/JSON data.
- **`admin_users` table**: Legacy table kept for backwards compatibility. The real authority is `users` with `role='admin'`. New code should only read/write `users`.
- **MySQL port is 3307** (not 3306) to avoid conflicts with local MySQL installations.
- **Image uploads**: The `uploads/` directory is served at `/uploads/:filename` and requires authentication (Bearer token or `?token=` query param). Uploaded URLs include the full server origin.
- **Varnish**: Optional and `restart: "no"` in docker-compose — it won't auto-restart. It requires `config/varnish.vcl` in the backend directory.
- **Biome vs ESLint**: Backend uses Biome for linting/formatting. Frontend uses ESLint + Prettier (via Next.js defaults). Do not cross-apply configs.
- **`bun run dev` uses `--watch`**: File changes auto-restart the backend. No need to restart manually during development.
- **SSL certs for local HTTPS**: Use `mkcert localhost 127.0.0.1 ::1` from within the `backend/` directory. The `.pem` files are gitignored.

---

## 10. Quick Start Checklist (for agents bootstrapping a dev environment)

- [ ] Docker Desktop is running
- [ ] `cd database && docker-compose up -d` — start Postgres, MySQL, Redis, Varnish
- [ ] `cp backend/.env.example backend/.env` — configure DB/Redis/JWT
- [ ] `cp frontend/.env.example frontend/.env.local` — configure API URL
- [ ] (Optional) `cd backend && mkcert localhost 127.0.0.1 ::1` — local HTTPS
- [ ] `cd backend && bun install && bun run dev`
- [ ] `cd frontend && npm install && npm run dev`
- [ ] Open `http://localhost:3000` → Setup Wizard → create admin → define schema

Or simply: **`./dev.sh`** from the repo root (handles Docker wait + both servers).

---

_Last updated: 2026-05-16 — auto-generated from codebase analysis._
