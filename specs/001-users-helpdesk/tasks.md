# Tasks — Feature 001

Legend: `[x]` done · traceability → spec acceptance criteria.

## Phase 0 — Foundation

- [x] T01 Monorepo with npm workspaces (`apps/*`, `packages/*`), Node 26 LTS, strict TS, ESLint, Prettier, Vitest
- [x] T02 `packages/shared`: Zod schemas for every request/response + domain rules (§4 constitution)
- [x] T03 Local PostgreSQL via `docker-compose.yml`, `.env.example`

## Phase 1 — Data (US-2, US-6)

- [x] T10 Drizzle schema `users`, `tickets`, `ticket_messages` → `0000_init.sql` (AC-2.1)
- [x] T11 Deterministic seed generator → `0001_seed_fake_users.sql`, 100 users + 25 tickets (AC-6.1, AC-6.2)
- [x] T12 `migrate.ts` entry point (Cloud Run job)

## Phase 2 — API

- [x] T20 Env validation, structured logging (Cloud Logging severities), graceful shutdown
- [x] T21 Firebase ID-token verification + user upsert/link by email (AC-1.2, AC-1.3)
- [x] T22 Role resolution from `ADMIN_EMAILS`; `requireAdmin` guard (AC-3.4, AC-4.5)
- [x] T23 `/api/me` GET/PATCH (AC-2.2, AC-2.3)
- [x] T24 User ticket routes, ownership enforced in SQL (AC-4.1 – AC-4.4)
- [x] T25 Admin users list/search/sort/detail (AC-3.1 – AC-3.3)
- [x] T26 Admin tickets list/filter/reply/status (AC-5.1 – AC-5.4)
- [x] T27 Helmet CSP (Firebase-compatible), rate limiting, uniform error shape (NFR-3)
- [x] T28 OpenAPI generated from shared schemas → `contracts/openapi.json`
- [x] T29 Integration tests on PGlite with real migrations (all US-1 … US-6 ACs)

## Phase 3 — Web (NFR-1)

- [x] T30 Vite + React 19 + Tailwind 4, light/dark theme, accessible primitives
- [x] T31 Firebase Google sign-in (popup), runtime config from `/api/config` (AC-1.1, AC-1.5)
- [x] T32 Role-based routing: admin → `/admin`, user → `/help` (AC-1.4, AC-4.5)
- [x] T33 Help desk: list, filter, create dialog, conversation, close, profile
- [x] T34 Admin: users table (search, sort, pagination in URL), user detail, requests inbox, reply, status
- [x] T35 Route-level code splitting + vendor chunks

## Phase 4 — Delivery (US-7)

- [x] T40 Multi-stage Dockerfile (single image for service + migrate job)
- [x] T41 `infra/scripts/01-bootstrap.sh` APIs, Artifact Registry (+cleanup policy), SAs, IAM, network
- [x] T42 `02-firebase.sh` Firebase project + web app config
- [x] T43 `03-database.sh` e2-micro COS VM, PostgreSQL 18, no external IP, secrets
- [x] T44 `04-deploy.sh` Cloud Build → migrate job → Cloud Run (Direct VPC egress), authorized domain
- [x] T45 GitHub Actions CI running `npm run check` + build
