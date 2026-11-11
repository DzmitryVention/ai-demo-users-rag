# Plan — Feature 001

## Stack

| Layer      | Choice                                                                          | Why                                                        |
| ---------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Runtime    | Node.js **26 LTS**                                                              | Latest Active LTS.                                         |
| Language   | TypeScript 6 (strict)                                                           | TS 7 (native) is not yet supported by `typescript-eslint`. |
| API        | Fastify 5 + `fastify-type-provider-zod`                                         | Fast, schema-first, typed routes.                          |
| Validation | Zod 4 in `packages/shared`                                                      | One schema for API + UI (constitution §4).                 |
| DB access  | Drizzle ORM + `pg`                                                              | Typed SQL, SQL-file migrations committed to git.           |
| Database   | PostgreSQL **18**                                                               | Newest stable major.                                       |
| Auth       | Firebase Authentication (Google provider) + `firebase-admin` token verification | Free (Spark limits), Google sign-in out of the box.        |
| Web        | React 19, Vite 8, Tailwind CSS 4, TanStack Query 5, React Router 8              | Modern, fast, accessible primitives.                       |
| Tests      | Vitest                                                                          | Same toolchain as Vite.                                    |
| Monorepo   | npm workspaces                                                                  | Zero extra tooling.                                        |

## Repository layout

```
apps/api         Fastify API; in production also serves the built SPA
apps/web         React SPA
packages/shared  Zod schemas + inferred types (no runtime deps besides zod)
infra/           Idempotent gcloud scripts, Cloud Build config, DB VM cloud-init
specs/           SDD artifacts
```

## Google Cloud architecture (free tier)

```
 Browser ──HTTPS──▶ Cloud Run service "helpdesk" (us-central1, scale-to-zero)
    │                  │  API + static SPA, Node 26 container
    │                  │  Direct VPC egress (no connector = no cost)
    │                  ▼
    │            Compute Engine e2-micro "helpdesk-db" (COS, no external IP)
    │                  PostgreSQL 18 container, 30 GB pd-standard
    │
    └──popup──▶ Firebase Authentication (Google provider)

 Cloud Build ─▶ Artifact Registry ─▶ Cloud Run (service + "migrate" job)
 Secret Manager: DB password, DATABASE_URL
```

| Service                     | Free tier used                                 |
| --------------------------- | ---------------------------------------------- |
| Cloud Run (service + job)   | 180k vCPU-s, 360k GiB-s, 2M requests / month   |
| Compute Engine              | 1 × e2-micro in us-central1, 30 GB standard PD |
| Artifact Registry           | 0.5 GB storage                                 |
| Cloud Build                 | 2,500 build-minutes / month (e2-standard-2)    |
| Secret Manager              | 6 active secret versions, 10k access ops       |
| Firebase Auth               | Google sign-in, 50k MAU                        |
| VPC / Private Google Access | free; Direct VPC egress has no connector cost  |

**Why not Cloud SQL?** No always-free tier (~$9+/month for the smallest instance).
**Why no external IP on the VM?** In-use external IPv4 addresses are billed and it
removes the DB from the internet. The VM pulls the Postgres image from Artifact
Registry and reads its password from Secret Manager over **Private Google Access**.

**Known trade-offs:** a single VM is not HA; backups are a manual `pg_dump` (see
`infra/README.md`). Acceptable for a demo; Cloud SQL is the upgrade path
(only `DATABASE_URL` changes).

## Auth & authorization flow

1. SPA loads `/api/config` → public Firebase web config (no rebuild per environment).
2. User clicks "Continue with Google" → `signInWithPopup`.
3. SPA sends `Authorization: Bearer <Firebase ID token>` on every API call.
4. API `authenticate` hook verifies the token with `firebase-admin`
   (signature, audience = project, expiry), requires `email_verified`.
5. API upserts the user (by `firebase_uid`, else links by lower(email)).
6. Role = `admin` iff email ∈ `ADMIN_EMAILS` (env); otherwise `user`.
   Role is computed per request, never stored, so it can't drift.
7. `requireAdmin` guard on `/api/admin/*`.

## API surface

See `contracts/openapi.yaml`. Summary:

| Method | Path                            | Role           |
| ------ | ------------------------------- | -------------- |
| GET    | /api/health                     | public         |
| GET    | /api/config                     | public         |
| GET    | /api/me                         | user           |
| PATCH  | /api/me                         | user           |
| GET    | /api/tickets                    | user (own)     |
| POST   | /api/tickets                    | user           |
| GET    | /api/tickets/:id                | user (own)     |
| POST   | /api/tickets/:id/messages       | user (own)     |
| POST   | /api/tickets/:id/close          | user (own)     |
| GET    | /api/admin/users                | admin          |
| GET    | /api/admin/users/:id            | admin          |
| GET    | /api/admin/tickets              | admin          |
| GET    | /api/admin/tickets/:id          | admin          |
| POST   | /api/admin/tickets/:id/messages | admin          |
| PATCH  | /api/admin/tickets/:id          | admin (status) |

Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.

## Configuration (12-factor)

| Var                                                                                  | Where                           |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| `DATABASE_URL`                                                                       | Secret Manager                  |
| `ADMIN_EMAILS`                                                                       | Cloud Run env (comma-separated) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` | Cloud Run env (public values)   |
| `PORT`, `LOG_LEVEL`, `NODE_ENV`                                                      | Cloud Run env                   |

## Migrations & demo data

Drizzle SQL migrations in `apps/api/drizzle/`, applied by the Cloud Run **job**
`helpdesk-migrate` before each deploy. `0001_seed_fake_users.sql` is generated
deterministically by `npm run db:generate-seed -w @app/api` (Faker, fixed seed)
and committed, so the data is reviewable and applied exactly once.
