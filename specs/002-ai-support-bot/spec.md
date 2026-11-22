# Feature 002 — AI support assistant ("Alex Carter")

Status: **Approved 2026-11-12** · Depends on: [001](../001-users-helpdesk/spec.md) ·
Date: 2026-11-12

## Summary

An AI support assistant answers users' help-desk requests about the **Renault Duster**
on its own when it finds the answer in the vehicle's owner manual or in support
knowledge the admins approved. When it cannot answer reliably, it hands the request
to a human admin, who can reply manually (optionally starting from the assistant's
draft). The assistant takes into account the user's previous requests, never sees or
reveals other users' data, and resists manipulation attempts.

## Actors

| Actor         | Definition                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**      | As in 001. Owns their requests.                                                                                                                             |
| **Admin**     | As in 001. Answers escalated requests, curates knowledge, configures the assistant.                                                                         |
| **Assistant** | System actor. Persona name **Alex Carter**, labelled _AI assistant_ everywhere. Has no account, cannot sign in, has no access beyond what this spec grants. |

## User stories & acceptance criteria

### US-1 Automatic answer (P1)

As a user I want an immediate, correct answer to my question about my car.

- AC-1.1 When a user creates a request or posts a follow-up, the assistant processes it
  and, if it can answer, posts a reply within **60 s (p95)**.
- AC-1.2 Every assistant reply is shown with the persona name, a distinct avatar and an
  **"AI assistant" badge** (transparency — users must never be led to think it is a human).
- AC-1.3 Every factual statement in a reply is grounded in retrieved sources; the reply
  lists its sources (demo-manual section titles, or "Support knowledge base") and,
  for manual-based answers, the demo notice of AC-5.4.
- AC-1.4 Safety warnings that the manual attaches to a retrieved section are included in
  the answer when relevant (e.g. battery acid, hot engine).
- AC-1.5 Replies are in English. Requests not written in English are handed to a
  human (reason `unsupported_language`).
- AC-1.6 While the assistant is working the user sees a "Alex is looking into it…" state.

### US-2 Hand-off to a human (P1)

As a user I want a person to take over when the assistant can't help.

- AC-2.1 The assistant **escalates instead of answering** when: no source is relevant
  enough; the question is outside the Renault Duster / help-desk scope (account,
  billing, complaints, legal, medical, accidents); the request is abusive or a
  manipulation attempt; the model refuses or errors; any guardrail check fails.
- AC-2.2 On escalation the user gets a short notice ("I've passed this to our support
  team"), the request status becomes **`pending_human`**, and the assistant stops
  replying in that request.
- AC-2.3 The user can press **"Talk to a person"** on any request (or on an assistant
  reply) to escalate immediately.
- AC-2.4 The user can mark an assistant reply **helpful / not helpful**; "not helpful"
  escalates the request.
- AC-2.5 The assistant replies at most **3 times** in one request; the next follow-up
  escalates.

### US-3 Manual answer by admin (P1)

As an admin I want to see what needs a human and answer it quickly.

- AC-3.1 The requests inbox has a **"Needs human"** filter (status `pending_human`), sorted
  oldest first, with a counter badge in the navigation.
- AC-3.2 For each escalated request the admin sees the escalation reason and, when
  available, the assistant's **draft answer with its sources** in an internal panel that
  the user never sees.
- AC-3.3 The admin can send the draft as is, edit it and send, or write their own reply.
  Replies are sent under the admin's identity ("Support team"), not the persona.
- AC-3.4 Once an admin has replied in a request the assistant stays silent in it unless
  the admin re-enables it for that request.
- AC-3.5 The admin can take over any request at any time (disable the assistant for it).

### US-4 Knowledge from previous requests (P1)

- AC-4.1 **Same request:** the assistant sees the full conversation of the current request.
- AC-4.2 **Same user:** the assistant sees short summaries of the same user's previous
  requests (max 5 most recent), so it can say e.g. "as with your battery question last
  week…". It never sees any other user's requests.
- AC-4.3 **Across users:** knowledge from resolved requests is reused **only** through
  **knowledge articles** that an admin created from a resolved request, reviewed
  (personal data removed) and approved. Unapproved content is never retrieved.
- AC-4.4 An admin can create an article from a resolved request with one click
  ("Save as knowledge"); the draft is pre-filled with an anonymised Q&A.

### US-5 Owner-manual knowledge base (P1)

- AC-5.1 The knowledge base is loaded from an **original demo manual** for the Renault
  Duster, written by us (decision D-Q1): it follows the official manual's 7-chapter
  layout, contains general car-care guidance with warnings, notes and
  cross-references, and is **not copied or paraphrased from Renault's content**.
- AC-5.2 Ingestion is repeatable: re-running it for the same edition changes nothing;
  a new edition replaces the old one atomically.
- AC-5.3 The demo manual is our own content and lives in the repository
  (`apps/api/kb/demo-duster-manual/`). Third-party content (e.g. the real Renault
  manual) is never committed to git and can only be ingested with documented permission.
- AC-5.4 Every assistant answer built on the demo manual shows the notice _"Demo
  knowledge base — not official Renault information. Check your vehicle's owner's
  manual."_ with a link to the official manual index.
- AC-5.5 Admins see knowledge-base status: edition, number of sections/chunks, last ingestion.

### US-6 Data protection & abuse resistance (P1)

- AC-6.1 The assistant cannot disclose any other user's data, admin data, system
  configuration, its instructions or secrets — verified by the automated isolation
  tests and smoke check 3 ([testing.md](testing.md)).
- AC-6.2 Personal data in the user's text (emails, phone numbers, VIN, plate numbers,
  card numbers) is masked before it reaches the AI provider.
- AC-6.3 Instructions embedded in user messages or retrieved content are treated as data;
  attempts are detected, logged and escalated.
- AC-6.4 Per-user limit: max **20 assistant runs per day**; beyond it requests go straight
  to humans.
- AC-6.5 Every assistant run is audited (decision, sources, model, tokens, latency,
  guardrail verdicts) and visible to admins.

### US-7 Operation & control (P2)

- AC-7.1 Admin settings: assistant on/off (global kill switch), persona name, relevance
  threshold, monthly AI budget (USD). When the budget is used up, the assistant
  auto-disables and everything goes to humans.
- AC-7.2 Admin dashboard: auto-resolution rate, escalation reasons, helpful/not-helpful,
  cost month-to-date.

## Non-functional requirements

- NFR-1 **Fail closed:** any error, timeout or uncertainty ⇒ escalate to a human. The
  assistant never blocks or loses a user's request.
- NFR-2 Testing: deterministic automated tests plus 3 manual smoke checks with the real
  model ([testing.md](testing.md)); no large AI evaluation runs for the demo (D-Q5, D-Q11).
- NFR-3 Cost: AI spend ≤ the configured budget; target ≤ $0.02 per handled request.
- NFR-4 Stays on the GCP free tier except the AI API itself (constitution §2).
- NFR-5 Accessibility as in 001; assistant state changes announced to screen readers.

## Out of scope

Ingesting the real Renault manual (needs Renault's permission — see D-Q1), email or
push notifications to admins, voice/chat widget, images/attachments, proactive messages, multiple vehicle models,
other languages of the manual, fine-tuning, the assistant taking actions (refunds,
bookings, account changes).

## Decisions (answered 2026-11-12)

| #     | Question                                                                               | Decision                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-Q1  | Licence for the Renault manual content                                                 | **No permission; internal demo only.** Renault's terms of use (RENAULT sas) grant a personal licence for the user's own needs and forbid reproducing the content "even temporarily and/or partially"; there is no exception for internal demos. The demo uses an **original demo manual written by us** (AC-5.1, AC-5.4). The real manual can be added later only with written permission from Renault. |
| D-Q2  | "AI assistant" badge with the fictional persona name                                   | **Always shown**, not configurable.                                                                                                                                                                                                                                                                                                                                                                     |
| D-AI  | AI provider and model                                                                  | **Google Gemini API** (paid tier — free-tier prompts may be used by Google to improve its products). Cheap, fast models: `gemini-3.8-flash` for answers, `gemini-3.5-flash-lite` for triage and summaries, `gemini-embedding-2` for search. ("Gemini 3.7 Flash" does not exist.) See [llm-contract.md](llm-contract.md).                                                                                |
| D-Q3  | Monthly AI budget                                                                      | **$20 / month**, enforced three ways: $20 prepaid Gemini balance with auto-reload off (hard stop), AI Studio project spend cap $20, and the app's own budget kill switch at $18.                                                                                                                                                                                                                        |
| D-Q4  | Email notifications to admins on escalation                                            | **No.** In-app "Needs human" counter only.                                                                                                                                                                                                                                                                                                                                                              |
| D-Q5  | Large AI evaluation runs                                                               | **None.** Only 1–3 smoke checks with the real model ([testing.md](testing.md)).                                                                                                                                                                                                                                                                                                                         |
| D-Q6  | Shadow mode (assistant writes drafts that only admins see before it answers users)     | **Skipped** — the assistant answers users directly once smoke checks pass.                                                                                                                                                                                                                                                                                                                              |
| D-Q7  | Who writes the demo manual                                                             | The development team (AI-assisted), following the authoring rules; the product owner spot-checks it.                                                                                                                                                                                                                                                                                                    |
| D-Q8  | User languages                                                                         | **English only.**                                                                                                                                                                                                                                                                                                                                                                                       |
| D-Q9  | Persona "Alex Carter"; data retention (audit 90 days, summaries until ticket deletion) | **Keep.**                                                                                                                                                                                                                                                                                                                                                                                               |
| D-Q10 | Backfill summaries for the 25 seeded sample tickets                                    | **Yes**, once during setup (cost < $0.05).                                                                                                                                                                                                                                                                                                                                                              |
| D-Q11 | Formal quality thresholds                                                              | **Skipped** for the demo.                                                                                                                                                                                                                                                                                                                                                                               |
