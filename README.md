# Headless CMS (Dynamic Schema) — Admin + API

Production-ready starter for a Headless CMS with:

- **Frontend** admin panel (Next.js App Router + TypeScript + Tailwind + shadcn/ui)
- **Backend** REST API (Bun + Elysia)
- **PostgreSQL** (Docker Compose)
- **Dynamic schema system** (setup wizard → generates tables + persists `schema/schema.json`)

## Tech stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Table, Sonner
- Backend: Bun, Elysia, Zod, PostgreSQL (postgres.js), JWT auth
- Database: PostgreSQL 16 (docker-compose)

## Folder structure

- `frontend/` — Admin panel UI
- `backend/` — Bun API server
- `database/` — Postgres docker-compose
- `schema/` — Generated schema file (source of truth for UI + validation)

## Prerequisites

- Node.js 20+
- Bun 1.1+
- Docker (for PostgreSQL)

## Quickstart (local)

1) Start Postgres:

```bash
cd database
docker compose up -d
```

2) Configure env:

- Copy `backend/.env.example` → `backend/.env`
- Copy `frontend/.env.example` → `frontend/.env.local`

Key env vars:

- Backend: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`
- Frontend: `NEXT_PUBLIC_API_URL`

3) Install + run backend:

```bash
cd backend
bun install
bun run dev
```

4) Install + run frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

- Admin UI: http://localhost:3000
- API: http://localhost:4000

## First-time setup flow

1) Go to the admin UI and create the **first admin user**.
2) Log in.
3) If no schema exists yet, you are redirected to the **Setup Wizard**:
   - Create one or more tables
   - Add columns and types
   - Apply schema
4) The backend:
   - Creates physical Postgres tables
   - Writes/updates `schema/schema.json`
   - Inserts a registry record into `cms_tables` / `cms_columns`

## Schema system (how it works)

- Source of truth on disk: `schema/schema.json`
- Source of truth in DB (registry tables):
  - `cms_tables`: table definitions
  - `cms_columns`: column definitions
- Applying schema is transactional:
  - Validate payload (types, names, duplicates)
  - Create missing tables + columns
  - Update registry
  - Persist updated schema to disk

Notes:

- Each generated table always includes: `id` (uuid), `created_at`, `updated_at`
- `id`, `created_at`, `updated_at` are reserved names and cannot be added as custom columns
- Schema changes are **additive** (no automatic drop/rename) to keep production safe

## API overview (selected)

- Auth
  - `POST /auth/bootstrap` (only if no admin exists)
  - `POST /auth/login`
- Setup/schema
  - `GET /setup/status`
  - `GET /schema`
  - `POST /schema/apply`
- Registry
  - `GET /tables`
  - `GET /tables/:table/columns`
- Dynamic CRUD
  - `GET /data/:table`
  - `GET /data/:table/:id`
  - `POST /data/:table`
  - `PUT /data/:table/:id`
  - `DELETE /data/:table/:id`

## Example usage

Create a row:

```bash
curl -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","published":true}' \
  http://localhost:4000/data/posts
```

List rows:

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/data/posts?limit=20&offset=0"
```
