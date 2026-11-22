# Knowledge ingestion — Renault Duster demo manual

## Licence decision (spec D-Q1)

Publisher of the official manual: **RENAULT sas**. Its _General terms of use_
(`/en/content/general-terms-use`) grant only a "personal, non-exclusive, revocable,
non-transferable" licence for the user's "own needs" and forbid reproducing the content
"even temporarily and/or partially", using "software or processes designed to reproduce
and/or copy the Content", and creating derivative works. We have no permission, and an
internal demo is not covered. Therefore:

1. **The demo knowledge base is an original demo manual written by us**, stored in the
   repo at `apps/api/kb/demo-duster-manual/` (rules below). `kb_sources.licence_ref =
'own-content'`.
2. **No Renault content is fetched, copied, paraphrased page-by-page or ingested.** The
   source analysis below records only the public structure (chapter names, page
   shape), used to make the demo realistic and to prepare a future licensed ingestion.
3. Ingesting third-party content stays behind a gate for the future: the job refuses a
   non-`own-content` source unless `KB_SOURCE_LICENSE_CONFIRMED=true` and
   `KB_LICENCE_REF` is set; such content never goes into git, logs or analytics.

## Demo manual — authoring rules

| Rule       | Detail                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure  | The 7 chapter names of the official manual; ~40 pages total (4–8 per chapter), 150–350 words each                                                                                                                           |
| Content    | General, widely known car-care and driving guidance written from scratch (e.g. checking oil level, jump-starting, tyre care, warning-light meanings in generic terms). Never copied or paraphrased from the Renault manual. |
| Numbers    | No invented model-specific specifications presented as fact (capacities, pressures, torques, dimensions). Point to the official source instead: "see the tyre-pressure label on the driver's door pillar"                   |
| Safety     | ~25 `WARNING` / `NOTE` blocks with conservative advice ("have this done by a qualified workshop")                                                                                                                           |
| Cross-refs | ~20 links between pages, to exercise `kb_links` and 1-hop expansion                                                                                                                                                         |
| Format     | One Markdown file per page with front-matter: `key`, `chapter`, `title`, `ordinal`, `links: [key…]`, `demo: true`; warnings as `> **WARNING:** …`, notes as `> **NOTE:** …`                                                 |
| Labelling  | Each file starts with a comment _"Demo content written for this project. Not official Renault information."_                                                                                                                |
| Review     | An admin reads every page before ingestion (no unsafe advice)                                                                                                                                                               |

## Source analysis (observed 2026-11-12)

| Item           | Finding                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual         | _New Renault Duster_, edition **01/04/2026 – 25/10/2026**, English, notice id `24320`                                                                                                                   |
| Index          | `https://www.user-manual.renault.com/en/notice/24320/index`                                                                                                                                             |
| Chapters (7)   | Welcome aboard your vehicle · Getting to know your vehicle · Driving · Your comfort · Maintenance · Practical advice · Technical specifications                                                         |
| Chapter URL    | `/en/renault-duster/{chapter-slug}-0` — lists sub-sections only, no body text                                                                                                                           |
| Page URL       | `/en/{chapter-slug}/{page-slug}-{n}` e.g. `/en/maintenance/battery-24`                                                                                                                                  |
| Cross-ref URL  | `/en/chapter/P1324/1.0/{code}` e.g. `12051_ALL_001_1` (stable content codes)                                                                                                                            |
| Page body      | server-rendered HTML; ~350 words; paragraphs, bullet lists, **warning boxes** (level-5 heading "warning"), **notes** (bold "Note"), images with empty or filename alt text, labelled diagrams (A, B, …) |
| Other views    | `/en/notice/24320/indicators` (dashboard warning lights), `/explore`, search                                                                                                                            |
| PDF            | `/sites/renault/files/GUI_NU_REN_P1324_1575_1_0_LHD-RHD_PRNT-en-GB.pdf`                                                                                                                                 |
| Estimated size | ~150–250 pages × ~350 words ≈ 60–90 k words ≈ 1–2 k chunks                                                                                                                                              |

## Source adapters

| Adapter                      | Status                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Markdown (demo manual)**   | **Default — implement now.** Reads `apps/api/kb/demo-duster-manual/*.md`                                                          |
| PDF / HTML (official manual) | **Deferred.** Only after written permission (D-Q1); the design above (structure, warnings, cross-ref codes) is kept for that case |

## Pipeline (Cloud Run job `helpdesk-kb-ingest`, same image)

```
fetch/read ─▶ parse ─▶ normalise ─▶ structure tree ─▶ chunk ─▶ embed ─▶ load (atomic swap)
```

1. **Parse** into a document tree: `chapter → section → page`, each with `title`,
   `external_key`, `url`/page number, `blocks[]` where a block is
   `paragraph | list | table | warning | note | figure-legend`.
   - Warning/note boxes → `kb_sections.warnings` **and** kept inline in the chunk text as
     `> ⚠ WARNING: …` so they are retrieved with their context.
   - Images: drop; keep figure legends ("A — battery terminal…"); drop filename alt text.
   - Cross-references → `kb_links` (resolved by `external_key`; unresolved ones logged).
   - Strip navigation, share links, language menus, footers.
2. **Normalise**: Unicode NFKC, collapse whitespace, unify units (keep original units
   text), Markdown for lists/tables.
3. **Chunk** (structure-aware):
   - Target 250–450 tokens, hard max 600; never split a list, table or warning.
   - One chunk never spans two pages/sections.
   - Each chunk starts with its breadcrumb line: `Maintenance › Battery`.
   - Small sibling pages (< 80 tokens) are merged into the parent's chunk.
4. **Embed** with `gemini-embedding-2` (768 dimensions) using the document prefix
   `title: {breadcrumb} | text: {chunk}`; batch requests.
5. **Load** in one transaction: insert new `kb_sources` (`ingesting`) + sections + links
   - chunks, then flip the old source to `retired` and the new one to `active`.
     Identical `content_hash` ⇒ no-op (AC-5.2).
6. **Report**: counts, unresolved links, chunks over limit, duration → job log and
   `kb_sources` row (shown in admin UI, AC-5.5).

## Retrieval (runtime)

1. Query text = masked user message (+ ticket subject); embed with `query: ` prefix.
2. Candidates: top 20 by cosine (HNSW) **and** top 20 by `ts_rank_cd` on `tsv`,
   from `kb_chunks` of the active source **and** approved `kb_articles`.
3. Fuse with Reciprocal Rank Fusion (k = 60); keep top 6.
4. Expand each hit with: breadcrumb, its section's `warnings`, and titles of 1-hop
   `kb_links` targets (recursive CTE, depth 1). Dedupe; cap the bundle at ~5 k tokens.
5. Relevance gate G4: escalate when the best cosine < `min_relevance` or no hit is in
   both lists' top 10 (adjusted by hand on the demo manual).

## Quality checks for ingestion

- Unit tests on the demo manual: tree shape, warnings captured, links resolved,
  no chunk > 600 tokens, idempotent re-run.
- Spot-check report: 20 random chunks printed for human review (local only).
