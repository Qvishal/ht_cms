# Headless CMS (Dynamic Schema) — Admin + API

Production-ready starter for a Headless CMS with:

- **Frontend** admin panel (Next.js App Router + TypeScript + Tailwind + shadcn/ui)
- **Backend** REST API (Bun + Elysia)
- **PostgreSQL** (Docker Compose)
- **Dynamic schema system** (setup wizard → generates tables + persists `schema/schema.json`)
- **Advanced Security (VAPT Hardened)**: Transport encryption, payload encryption, rate limiting, and more.

## Tech stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Table, Web Crypto API
- Backend: Bun, Elysia, Zod, PostgreSQL (postgres.js), JWT auth, Redis (Rate limiting)
- Database: PostgreSQL 16 (docker-compose), Redis

## Folder structure

- `frontend/` — Admin panel UI
- `backend/` — Bun API server
- `backend/uploads/` — Secure native image storage
- `database/` — Postgres docker-compose
- `schema/` — Generated schema file (source of truth for UI + validation)

## Prerequisites

- Node.js 20+
- Bun 1.1+
- Docker (for PostgreSQL + Redis)
- [mkcert](https://github.com/FiloSottile/mkcert) (for local HTTPS development)

## Quickstart (local)

1) Start Services:

```bash
cd database
docker compose up -d
```

2) Generate local SSL certificates:

```bash
cd backend
mkcert localhost 127.0.0.1 ::1
```

3) Configure env:

- Copy `backend/.env.example` → `backend/.env`
- Copy `frontend/.env.example` → `frontend/.env.local`
- Update `SSL_CERT_PATH` and `SSL_KEY_PATH` in `backend/.env` to point to the generated `.pem` files.

4) Install + run:

```bash
# Backend
cd backend && bun install && bun run dev

# Frontend
cd frontend && npm install && npm run dev
```

Open:
- Admin UI: http://localhost:3001
- Secure API: https://localhost:4433 (Redirects from http://localhost:4000)

## Security & VAPT Hardening

This CMS is built with a security-first approach:

### 🛡️ Transport Security (HTTPS)
- **FORCE_HTTPS**: Enforces SSL/TLS for all API traffic.
- **HSTS**: `Strict-Transport-Security` headers tell browsers to only use HTTPS for 1 year.
- **Native TLS**: Support for Bun native TLS server using `SSL_CERT_PATH`.

### 🛡️ Application-Level Encryption (ALE)
- **Payload Encryption**: All JSON bodies (Request & Response) are encrypted using **AES-256-GCM** before being sent over the wire.
- **Probabilistic**: Uses unique Initialization Vectors (IV) for every message.
- **CORS Support**: Custom `x-payload-encrypted` header is allowed and exposed.
- Toggle via `ENCRYPT_PAYLOADS` and `PAYLOAD_ENCRYPTION_KEY`.

### 🛡️ Brute-Force Protection
- **Rate Limiting**: Redis-backed brute-force protection on `/auth/login` (5 attempts / 15 mins per IP).

### 🛡️ Image Security
- **Auth Guarded**: Images in `backend/uploads/` are NOT accessible publicly.
- **Token Access**: Direct browser viewing requires a `?token=...` query parameter.
- **Native Multipart**: `/upload` uses native Elysia `t.File()` parsing for extreme stability and isolation from global hooks.

## Features

### 🖼️ Image Column Support
- Add a column with type `image`.
- Supports direct URL entry or **Native File Upload**.
- Thumbnails and previews integrated into the dashboard.

### 💨 Performance
- **Native Gzip**: All API JSON responses are compressed via `Bun.gzipSync` (~50% size reduction).

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

## API overview (selected)

- Auth
  - `POST /auth/bootstrap` (only if no admin exists)
  - `POST /auth/login` (Rate limited)
- Setup/schema
  - `GET /setup/status`
  - `GET /schema`
  - `POST /schema/apply`
- Registry
  - `GET /tables`
  - `GET /tables/:table/columns`
- Dynamic CRUD
  - `GET /data/:table`
  - `POST /data/:table` (Encrypted)
  - `PUT /data/:table/:id` (Encrypted)
  - `DELETE /data/:table/:id`
- Uploads
  - `POST /upload` (Multipart, isolated from encryption hooks)
  - `GET /uploads/:filename` (Auth required, supports token param)

## Example usage (ALE Encrypted)

When encryption is on, payloads must wrap the cipher in `{"encrypted": "..."}`.

```bash
# Encrypted creation
curl -k -X POST https://localhost:4433/data/posts \
  -H "Authorization: Bearer <token>" \
  -H "X-Payload-Encrypted: true" \
  -H "Content-Type: application/json" \
  -d '{"encrypted":"<base64_aes_gcm_payload>"}'
```

