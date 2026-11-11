# Project Constitution

Non-negotiable principles for every feature in this repository. Specs, plans and
code reviews are checked against this document.

## 1. Spec-Driven Development (SDD)

Every feature lives in `specs/NNN-feature-name/` and moves through these artifacts,
in order. Code is never written before the artifact that justifies it.

| Artifact        | Answers                                                            |
| --------------- | ------------------------------------------------------------------ |
| `spec.md`       | **What** and **why** (user stories, acceptance criteria). No tech. |
| `plan.md`       | **How** (architecture, stack, trade-offs).                         |
| `data-model.md` | Entities, constraints, migrations.                                 |
| `contracts/`    | API contract (OpenAPI) – source of truth for the HTTP surface.     |
| `tasks.md`      | Ordered, checkable implementation tasks traced to requirements.    |

A change in behaviour starts with a change to `spec.md`.

## 2. Cost: free tier first

Only Google Cloud services with an always-free tier (or a free usage limit) may be
used. Any resource that would incur cost in normal demo usage must be called out
in `plan.md` with an estimate before it is introduced.

## 3. Security by default

- Authentication is delegated to Google (Firebase Authentication). The backend
  trusts nothing but a verified Firebase ID token.
- Authorization is enforced **server-side** on every request. UI hiding is a UX
  concern only.
- Secrets live in Secret Manager, never in git, images or plain env files.
- The database has no public IP.
- All input is validated with a schema at the boundary (Zod).

## 4. One source of truth for types

Request/response schemas are defined once in `packages/shared` and consumed by
both the API and the web app.

## 5. Quality gates

`npm run check` (format, lint, typecheck, test) must pass before merge. CI runs
the same command.

## 6. Infrastructure as scripts

All infrastructure is created by idempotent `gcloud` scripts in `infra/`. Running
a script twice must be safe. No click-ops except steps the CLI cannot perform,
which are documented in `infra/README.md`.

## 7. Latest LTS runtimes

Node.js uses the current Active LTS line; PostgreSQL uses the newest stable major.
