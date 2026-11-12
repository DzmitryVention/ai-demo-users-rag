# Data model — Feature 002

All tables live in the **same `helpdesk` database as feature 001** on the shared
PostgreSQL 18 server (plan D7). All changes are additive Drizzle migrations on top of 001. Requires the `vector` extension (pgvector image, see plan).

```
kb_sources 1──* kb_sections 1──* kb_chunks          kb_articles (approved Q&A)
                   │  ▲ parent_id (tree)                  │ source_ticket_id ──▶ tickets
                   └──* kb_links (cross-refs)             │
tickets 1──* ticket_messages            bot_runs *──1 tickets
   │ 1──1 ticket_summaries              bot_settings (single row)
```

## Changes to 001 tables

### `ticket_status` enum

Add **`pending_human`** → `open | answered | pending_human | closed`.

### `author_role` enum

Add **`bot`** → `user | admin | bot`.

### `tickets` (new columns)

| Column            | Type                                                    | Notes                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bot_state         | enum `bot_state` (`idle`,`queued`,`running`,`disabled`) | default `idle`                                                                                                                                                                                                                  |
| bot_turns         | int                                                     | default 0, bot replies posted in this ticket                                                                                                                                                                                    |
| escalation_reason | enum `escalation_reason` NULL                           | `no_relevant_source`, `out_of_scope`, `unsupported_language`, `injection_suspected`, `abusive`, `user_requested`, `not_helpful`, `max_turns`, `quota_exceeded`, `budget_exceeded`, `model_refusal`, `guardrail_failed`, `error` |
| escalated_at      | timestamptz NULL                                        | for "oldest first" queue                                                                                                                                                                                                        |

Index: `(status, escalated_at)` for the "Needs human" queue.

### `ticket_messages` (new columns)

| Column     | Type                                | Notes                                                                                                                       |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| author_id  | uuid **NULL**                       | was NOT NULL; NULL for `author_role = 'bot'` (persona is not a user). CHECK: `author_role = 'bot' OR author_id IS NOT NULL` |
| visibility | enum (`public`,`internal`)          | default `public`. `internal` = admin-only (bot drafts, notes). **Every user-facing query filters `visibility = 'public'`.** |
| citations  | jsonb NULL                          | list of `{kind, id, title, url?}`, kind = `manual` or `article` — display data only                                         |
| bot_run_id | uuid NULL FK → bot_runs             | provenance                                                                                                                  |
| feedback   | enum (`helpful`,`not_helpful`) NULL | set by requester on bot messages                                                                                            |

## New tables

### `kb_sources` — one row per ingested document edition

| Column       | Type                                  | Notes                                                                                      |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| id           | uuid PK                               |                                                                                            |
| kind         | enum (`manual`)                       |                                                                                            |
| title        | text                                  | "New Renault Duster — Owner manual"                                                        |
| edition      | text                                  | "2026-04-01..2026-10-25"                                                                   |
| language     | text                                  | `en`                                                                                       |
| origin_url   | text                                  | official landing page (for attribution links)                                              |
| content_hash | text                                  | hash of normalised content (idempotency)                                                   |
| status       | enum (`ingesting`,`active`,`retired`) | exactly one `active` per kind (partial unique index)                                       |
| licence_ref  | text NOT NULL                         | `own-content` for the demo manual; otherwise the permission document reference (spec D-Q1) |
| ingested_at  | timestamptz                           |                                                                                            |

### `kb_sections` — the document tree

| Column       | Type                                   | Notes                                                                                                                     |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| id           | uuid PK                                |                                                                                                                           |
| source_id    | uuid FK → kb_sources ON DELETE CASCADE |                                                                                                                           |
| parent_id    | uuid NULL FK → kb_sections             | chapter → section → page                                                                                                  |
| level        | smallint                               | 1 = chapter                                                                                                               |
| ordinal      | int                                    | order among siblings                                                                                                      |
| external_key | text                                   | stable key from the source (URL slug / chapter code, e.g. `P1324/1.0/12051_ALL_001_1`) — UNIQUE (source_id, external_key) |
| title        | text                                   |                                                                                                                           |
| path         | text                                   | breadcrumb "Maintenance › Battery"                                                                                        |
| url          | text NULL                              | official page for citations                                                                                               |
| warnings     | jsonb                                  | list of `{kind, text}`, kind = `warning` or `note`, attached to this section                                              |

### `kb_links` — cross-references

| Column          | Type    | Notes         |
| --------------- | ------- | ------------- |
| from_section_id | uuid FK | PK (from, to) |
| to_section_id   | uuid FK |               |
| anchor_text     | text    |               |

### `kb_chunks` — retrieval units

| Column       | Type                                                       | Notes                                                 |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| id           | uuid PK                                                    | cited by the model (as short alias, see LLM contract) |
| section_id   | uuid FK → kb_sections ON DELETE CASCADE                    |                                                       |
| ordinal      | int                                                        |                                                       |
| text         | text                                                       | normalised Markdown, prefixed with breadcrumb         |
| token_count  | int                                                        |                                                       |
| embedding    | vector(768)                                                | gemini-embedding-2, normalised                        |
| tsv          | tsvector GENERATED (`to_tsvector('english', text)`) STORED |                                                       |
| content_hash | text                                                       |                                                       |

Indexes: HNSW on `embedding vector_cosine_ops`; GIN on `tsv`.

### `kb_articles` — approved cross-user knowledge (AC-4.3)

| Column                   | Type                                      | Notes                                |
| ------------------------ | ----------------------------------------- | ------------------------------------ |
| id                       | uuid PK                                   |                                      |
| question                 | text                                      | anonymised                           |
| answer                   | text                                      | anonymised                           |
| source_ticket_id         | uuid NULL FK → tickets ON DELETE SET NULL | provenance, never shown to the model |
| status                   | enum (`draft`,`approved`,`archived`)      | **only `approved` is retrievable**   |
| created_by / approved_by | uuid FK → users                           |                                      |
| embedding, tsv           | as kb_chunks                              | computed on approval                 |
| created_at / approved_at | timestamptz                               |                                      |

### `ticket_summaries` — compact per-user history (AC-4.2)

| Column     | Type                                   | Notes                                                                             |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| ticket_id  | uuid PK FK → tickets ON DELETE CASCADE |                                                                                   |
| user_id    | uuid FK → users                        | denormalised for RLS + index `(user_id, updated_at desc)`                         |
| summary    | text                                   | ≤ 400 chars, PII-masked, generated by Flash-Lite when a ticket is answered/closed |
| updated_at | timestamptz                            |                                                                                   |

### `bot_runs` — audit log (AC-6.5)

| Column                                         | Type                                    | Notes                                                |
| ---------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| id                                             | uuid PK                                 |                                                      |
| ticket_id, message_id                          | uuid FK                                 | trigger                                              |
| user_id                                        | uuid                                    | requester (quota counting)                           |
| decision                                       | enum (`answered`,`escalated`,`skipped`) |                                                      |
| escalation_reason                              | `escalation_reason` NULL                |                                                      |
| triage                                         | jsonb                                   | classifier output                                    |
| retrieved                                      | jsonb                                   | `[{kind, id, score}]` — ids and scores only, no text |
| guardrails                                     | jsonb                                   | each gate → pass/fail + rule id                      |
| model_answer, model_triage, prompt_version     | text                                    |                                                      |
| input_tokens, output_tokens, cache_read_tokens | int                                     |                                                      |
| cost_usd                                       | numeric(10,6)                           | computed from a price table in code                  |
| latency_ms                                     | int                                     |                                                      |
| request_id                                     | text                                    | provider response id for support                     |
| created_at                                     | timestamptz                             | retention **90 days** (daily purge job)              |

### `bot_settings` — single row

`mode` (`off`,`live`), `persona_name`, `persona_avatar`, `min_relevance`,
`max_turns_per_ticket`, `max_runs_per_user_per_day`, `monthly_budget_usd`, `updated_by`,
`updated_at`.

## Database roles & row-level security (defence in depth)

| Role                  | Used by                  | Grants                                                                                                                                                            |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helpdesk` (existing) | API, migrations          | owner                                                                                                                                                             |
| **`helpdesk_bot`**    | bot context builder only | SELECT on `kb_*` (approved articles via view), `ticket_summaries`, `tickets`, `ticket_messages`; nothing on `users` except a view `bot_requester(id, first_name)` |

RLS on `tickets`, `ticket_messages`, `ticket_summaries` for `helpdesk_bot`:
`USING (user_id = current_setting('app.requester_id')::uuid)` (messages via ticket).
The pipeline opens a transaction, `SET LOCAL ROLE helpdesk_bot`,
`SET LOCAL app.requester_id = <ticket owner>`, then builds the context. A bug in the
context builder therefore still cannot read another user's rows.

## Migrations

| File                      | Content                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `0002_bot_core.sql`       | enums, ticket/message columns, `bot_runs`, `bot_settings` (mode `off`), `ticket_summaries` |
| `0003_knowledge_base.sql` | `CREATE EXTENSION vector`, `kb_*` tables, indexes                                          |
| `0004_bot_rls.sql`        | `helpdesk_bot` role (password from Secret Manager, set by infra), grants, RLS policies     |

No manual content in migrations (plan D6).
