# API contract changes — Feature 002

Schemas are added to `packages/shared` first; `openapi.json` is regenerated
(`npm run contract:export`). Error shape unchanged.

## Shared schema changes

- `TicketStatusSchema` += `pending_human`
- `RoleSchema` for message authors += `bot` (new `AuthorRoleSchema`)
- `TicketMessageSchema`: `author` becomes nullable (bot); adds
  `persona?: { name, avatarUrl }`, `citations?: Citation[]`, `feedback?: 'helpful'|'not_helpful'|null`
- `TicketSummarySchema` += `botState: 'idle'|'queued'|'running'|'disabled'`,
  `escalationReason: EscalationReason|null`
- New: `CitationSchema = { kind: 'manual'|'article', title, url: string|null }`
- New: `BotSettingsSchema`, `BotRunSchema`, `KbStatusSchema`, `KbArticleSchema`

## User endpoints (owner only, as in 001)

| Method | Path                                          | Body                                            | Effect                                              |
| ------ | --------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| POST   | /api/tickets                                  | (unchanged)                                     | also enqueues a bot run if eligible                 |
| POST   | /api/tickets/:id/messages                     | (unchanged)                                     | also enqueues a bot run if eligible                 |
| POST   | /api/tickets/:id/escalate                     | —                                               | `pending_human`, reason `user_requested` (AC-2.3)   |
| POST   | /api/tickets/:id/messages/:messageId/feedback | `{ value }`, value = `helpful` or `not_helpful` | bot messages only; `not_helpful` escalates (AC-2.4) |

User responses never include `visibility = internal` messages or `bot_runs` data.

## Admin endpoints

| Method    | Path                                          | Purpose                                                                |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| GET       | /api/admin/tickets?status=pending_human       | "Needs human" queue (sort `escalated_at` asc)                          |
| GET       | /api/admin/tickets/:id                        | now includes internal messages (drafts) and `escalationReason`         |
| POST      | /api/admin/tickets/:id/messages               | `{ body, fromDraftId? }` — manual reply; disables bot for ticket       |
| PATCH     | /api/admin/tickets/:id/bot                    | `{ enabled: boolean }` — take over / hand back (AC-3.4/3.5)            |
| GET / PUT | /api/admin/bot/settings                       | mode, persona, thresholds, budget (AC-7.1)                             |
| GET       | /api/admin/bot/runs?ticketId=&decision=&page= | audit log (AC-6.5)                                                     |
| GET       | /api/admin/bot/stats?from=&to=                | dashboard metrics (AC-7.2)                                             |
| GET       | /api/admin/kb/status                          | active edition, counts, last ingestion (AC-5.5)                        |
| POST      | /api/admin/kb/articles                        | `{ ticketId }` — create anonymised draft (AC-4.4)                      |
| PATCH     | /api/admin/kb/articles/:id                    | edit `{ question, answer }`, or `{ status }` = `approved` / `archived` |
| GET       | /api/admin/kb/articles?status=                | list                                                                   |

## Internal endpoint (not under /api, not in OpenAPI)

| Method | Path              | Auth                                                                                                    | Body                                                   |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| POST   | /internal/bot/run | Google OIDC token of the Cloud Tasks service account; audience = service URL + path; rejected otherwise | `{ ticketId, messageId }` — idempotent per `messageId` |

Returns 2xx for handled/skipped (so Tasks doesn't retry business outcomes), 5xx only for
transient failures; after the last retry the ticket is escalated with reason `error`.
