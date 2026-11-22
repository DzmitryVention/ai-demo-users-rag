# Demo owner's guide (knowledge base for the AI assistant)

Original demo content written for this project (spec 002, decision D-Q1). It follows
the chapter layout of a car owner's manual but is **not** copied or paraphrased from
any Renault publication and is **not official Renault information**.

- `manual.json` — title, edition, chapters, the notice shown under answers.
- `<chapter>/<page>.md` — one page per file. Front-matter: `key`, `title`, `ordinal`,
  `links` (keys of related pages). Warnings: `> **WARNING:** …`, notes: `> **NOTE:** …`.
- Ingest: `npm run kb:ingest -w @app/api` (idempotent; re-embeds only when content changes).

Content rules: general, conservative guidance only; no invented model-specific figures
(capacities, pressures, torques) — point to labels and the official manual instead;
anything risky is "have it done by a qualified workshop".
