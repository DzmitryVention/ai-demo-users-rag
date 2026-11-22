# Help desk — users pool & support on Google Cloud (free tier)

Google sign-in web app: users open support requests; admins (emails listed in
`ADMIN_EMAILS`) browse the full users pool and answer requests.

Built with **Spec-Driven Development** — start with [`specs/`](specs/):

|                                                                        |                                           |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| [Constitution](specs/constitution.md)                                  | Principles every change follows           |
| [Spec](specs/001-users-helpdesk/spec.md)                               | User stories & acceptance criteria        |
| [Plan](specs/001-users-helpdesk/plan.md)                               | Architecture, stack, GCP free-tier design |
| [Data model](specs/001-users-helpdesk/data-model.md)                   | Tables, status machine, migrations        |
| [Contract](specs/001-users-helpdesk/contracts/openapi.json)            | OpenAPI generated from shared Zod schemas |
| [Tasks](specs/001-users-helpdesk/tasks.md)                             | Implementation checklist                  |
| [Feature 002 — AI support assistant](specs/002-ai-support-bot/spec.md) | Approved: RAG bot, hand-off, guardrails   |

## Stack

Node.js 26 LTS · TypeScript · Fastify 5 · Drizzle ORM · PostgreSQL 18 · Firebase Auth ·
React 19 · Vite 8 · Tailwind CSS 4 · TanStack Query · Vitest ·
Cloud Run · Compute Engine e2-micro · Artifact Registry · Cloud Build · Secret Manager

## Repository

```
apps/api          Fastify API (+ serves the SPA in production), migrations in apps/api/drizzle
apps/web          React SPA
packages/shared   Zod schemas & types shared by API and web
infra/            gcloud deployment scripts (see infra/README.md)
specs/            SDD artifacts
```

## Local development

Requires Node 26 (`nvm use`) and Docker (for Postgres).

```bash
npm ci
cp .env.example .env          # fill FIREBASE_* (from infra/.state/firebase.env after step 2)
npm run db:up                 # Postgres 18 on :5432
npm run db:migrate            # schema + 100 fake users
npm run dev                   # API :8080, web :5173 (proxies /api)
```

`localhost` is an authorized Firebase domain by default, so Google sign-in works locally.

## Quality

```bash
npm run check    # prettier + eslint (strict, type-aware) + tsc + vitest
npm run build
```

API integration tests run against **PGlite** (real Postgres in-process) with the real
migrations, so no database is needed to run tests.

## Database migrations

```bash
# after editing apps/api/src/db/schema.ts
npm run db:generate -w @app/api
# regenerate the deterministic fake-data migration
npm run db:generate-seed -w @app/api
```

## Deploy to Google Cloud

```bash
gcloud config set project <PROJECT_ID>
./infra/deploy.sh
```

Details, the one manual Firebase step, operations and teardown: [infra/README.md](infra/README.md).
