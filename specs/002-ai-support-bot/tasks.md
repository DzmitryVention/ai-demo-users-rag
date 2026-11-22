# Tasks — Feature 002

Legend: `[ ]` to do · → spec AC / doc reference. All decisions are recorded in
spec.md; the knowledge base is our own demo manual.

## Phase 0 — Decisions & approvals

- [x] T01 Answer open questions (spec.md § Decisions)
- [x] T01a Approve the spec
- [ ] T02 Amend constitution with §8 AI principles (done in this PR, review)

## Phase 1 — Platform

- [ ] T10 Switch DB image to `pgvector/pgvector:pg18` (mirror to AR, update cloud-init, `03-database.sh`); verify data survives container swap
- [ ] T11 Secrets: `GEMINI_API_KEY`, `helpdesk-bot-db-password`; grant to run SA
- [ ] T12 Cloud Tasks queue `helpdesk-bot` + `helpdesk-tasks` SA with `run.invoker` (new `05-bot.sh`, idempotent)
- [ ] T13 `KB ingest` Cloud Run job definition
- [ ] T15 Gemini billing: paid tier, **$20 prepaid** balance with auto-reload off, AI Studio project spend cap $20, API key restricted to the Gemini API → plan § Cost
- [ ] T14 Price table + budget accounting helper (→ AC-7.1)

## Phase 2 — Data

- [ ] T20 `0002_bot_core.sql` (enums, columns, bot_runs, bot_settings, ticket_summaries) → data-model.md
- [ ] T21 `0003_knowledge_base.sql` (vector ext, kb_* tables, HNSW/GIN)
- [ ] T22 `0004_bot_rls.sql` (`helpdesk_bot` role, RLS policies)
- [ ] T23 Update 001 queries: user endpoints filter `visibility = public`; bot author handling
- [ ] T24 Shared schemas (contracts/api.md) + regenerate OpenAPI

## Phase 3 — Knowledge base

- [ ] T30 Write the original demo manual (~40 pages, 7 chapters, warnings, notes, cross-refs) per knowledge-ingestion.md § authoring rules; product owner spot-check
- [ ] T31 Parser interface + Markdown adapter (PDF/HTML adapters deferred until permission)
- [ ] T32 Normaliser + structure-aware chunker (+ unit tests: limits, warnings never split)
- [ ] T33 Embedder on `gemini-embedding-2` (768-d, document/query prefixes) behind the `Embedder` interface
- [ ] T34 Loader with atomic edition swap + idempotency (AC-5.2) + report (AC-5.5)
- [ ] T35 Ingest the demo manual into the production DB; spot-check; demo notice shown on answers (AC-5.4)
- [ ] T36 Hybrid retriever (vector + FTS + RRF) + 1-hop expansion CTE + relevance gate

## Phase 4 — Bot pipeline

- [ ] T40 Enqueue on message create (eligibility L0), `bot_state` transitions → plan § state machine
- [ ] T41 `/internal/bot/run` with OIDC verification, idempotency per messageId (T8)
- [ ] T42 Guardrails L1 hygiene, L2 PII masking/un-masking (+ exhaustive unit tests)
- [ ] T43 LLM wrapper on `@google/genai`: triage (Flash-Lite), answer (Flash), summary, article draft; safety-block and 402/429 handling → llm-contract.md
- [ ] T44 Context builder under `helpdesk_bot` role + RLS (+ cross-user isolation integration tests)
- [ ] T45 System prompt v1 + context bundle with nonces and aliases + canary
- [ ] T46 L5 output validation (schema, citations ⊆ retrieved, PII/canary/URL/length checks)
- [ ] T47 Publish/escalate step, internal drafts, audit row (`bot_runs`), cost accounting
- [ ] T48 Summaries on answered/closed + one-time backfill for seeded tickets (D-Q10); 90-day `bot_runs` purge (scheduled job)

## Phase 5 — UI

- [ ] T50 User: persona avatar + "AI assistant" badge, citations chips, "Alex is looking into it…", "Talk to a person", 👍/👎 (AC-1.2/1.6, 2.3, 2.4)
- [ ] T51 Admin: "Needs human" filter + nav counter, escalation reason, internal draft panel (send / edit / discard), take-over toggle (US-3)
- [ ] T52 Admin: Bot settings page, audit log, stats dashboard (US-7)
- [ ] T53 Admin: Knowledge base page — status, articles (create from ticket, edit, approve, archive) (US-4/5)
- [ ] T54 Privacy notice text on help desk page

## Phase 6 — Testing & launch

- [ ] T60 Automated tests with fake LLMs (guardrails, isolation, pipeline, KB) → testing.md § 1
- [ ] T61 Smoke-check script (3 cases) → testing.md § 2
- [ ] T62 Run smoke checks after deploy; record results
- [ ] T63 Set `mode = live`; watch audit log and spend
