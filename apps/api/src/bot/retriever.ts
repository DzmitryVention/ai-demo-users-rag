/**
 * Hybrid retrieval over the knowledge base (specs/002 knowledge-ingestion.md § Retrieval):
 * vector similarity + Postgres full-text search, fused with Reciprocal Rank Fusion,
 * then expanded with breadcrumb, section warnings and 1-hop linked page titles.
 *
 * Runs inside the assistant's RLS-restricted transaction, so `kb_articles` only
 * returns approved articles.
 */
import { sql } from 'drizzle-orm';
import { queryRows, type DbExecutor } from '../db/client.ts';

export interface RetrievedSource {
  kind: 'manual' | 'article';
  id: string;
  title: string;
  path: string;
  text: string;
  warnings: { kind: string; text: string }[];
  related: string[];
  /** Cosine similarity of the best vector match (0 when only full-text matched). */
  similarity: number;
  rrf: number;
}

export interface RetrievalResult {
  sources: RetrievedSource[];
  bestSimilarity: number;
  isDemoSource: boolean;
}

const RRF_K = 60;
const CANDIDATES = 20;

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

export const toVectorLiteral = (v: number[]) => `[${v.map((x) => x.toFixed(7)).join(',')}]`;

interface Row extends Record<string, unknown> {
  kind: 'manual' | 'article';
  id: string;
  similarity: number | string | null;
  vrank: number | string | null;
  trank: number | string | null;
}

export async function retrieve(
  db: DbExecutor,
  query: { embedding: number[]; text: string },
  limit = 6,
): Promise<RetrievalResult> {
  const vec = toVectorLiteral(query.embedding);
  const text = query.text.slice(0, 300);

  const ranked = await queryRows<Row>(
    db,
    sql`
    with active as (select id, is_demo from kb_sources where status = 'active' limit 1),
    vec_chunks as (
      select 'manual'::text as kind, c.id, 1 - (c.embedding <=> ${vec}::vector) as similarity,
             row_number() over (order by c.embedding <=> ${vec}::vector) as vrank
      from kb_chunks c
      join kb_sections s on s.id = c.section_id
      where s.source_id = (select id from active)
      order by c.embedding <=> ${vec}::vector
      limit ${CANDIDATES}
    ),
    vec_articles as (
      select 'article'::text as kind, a.id, 1 - (a.embedding <=> ${vec}::vector) as similarity,
             row_number() over (order by a.embedding <=> ${vec}::vector) as vrank
      from kb_articles a
      where a.status = 'approved' and a.embedding is not null
      order by a.embedding <=> ${vec}::vector
      limit ${CANDIDATES}
    ),
    txt as (
      select kind, id, row_number() over (order by rank desc) as trank from (
        select 'manual'::text as kind, c.id, ts_rank_cd(c.tsv, q) as rank
        from kb_chunks c join kb_sections s on s.id = c.section_id,
             websearch_to_tsquery('english', ${text}) q
        where s.source_id = (select id from active) and c.tsv @@ q
        union all
        select 'article'::text, a.id, ts_rank_cd(a.tsv, q)
        from kb_articles a, websearch_to_tsquery('english', ${text}) q
        where a.status = 'approved' and a.tsv @@ q
      ) t
      order by rank desc
      limit ${CANDIDATES}
    ),
    vec as (select * from vec_chunks union all select * from vec_articles)
    select coalesce(v.kind, t.kind) as kind, coalesce(v.id, t.id) as id,
           v.similarity, v.vrank, t.trank
    from vec v full outer join txt t on t.id = v.id
  `,
  );

  const scored = ranked
    .map((r) => {
      const vrank = r.vrank == null ? null : Number(r.vrank);
      const trank = r.trank == null ? null : Number(r.trank);
      const rrf = (vrank ? 1 / (RRF_K + vrank) : 0) + (trank ? 1 / (RRF_K + trank) : 0);
      return { kind: r.kind, id: r.id, similarity: Number(r.similarity ?? 0), rrf };
    })
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit);

  const active = await queryRows<{ is_demo: boolean }>(
    db,
    sql`select is_demo from kb_sources where status = 'active' limit 1`,
  );
  const isDemoSource = active[0]?.is_demo ?? false;
  if (scored.length === 0) return { sources: [], bestSimilarity: 0, isDemoSource };

  const chunkIds = scored.filter((s) => s.kind === 'manual').map((s) => s.id);
  const articleIds = scored.filter((s) => s.kind === 'article').map((s) => s.id);

  const chunkDetails = chunkIds.length
    ? await queryRows<{
        id: string;
        text: string;
        title: string;
        path: string;
        warnings: { kind: string; text: string }[];
        related: string[] | null;
      }>(
        db,
        sql`
        select c.id, c.text, s.title, s.path, s.warnings,
               (select array_agg(t.title order by t.title)
                  from kb_links l join kb_sections t on t.id = l.to_section_id
                  where l.from_section_id = s.id) as related
        from kb_chunks c join kb_sections s on s.id = c.section_id
        where c.id in (${idList(chunkIds)})
      `,
      )
    : [];
  const articleDetails = articleIds.length
    ? await queryRows<{ id: string; question: string; answer: string }>(
        db,
        sql`
        select id, question, answer from kb_articles
        where id in (${idList(articleIds)})
      `,
      )
    : [];

  const chunkMap = new Map(chunkDetails.map((r) => [r.id, r]));
  const articleMap = new Map(articleDetails.map((r) => [r.id, r]));

  const sources: RetrievedSource[] = [];
  for (const s of scored) {
    if (s.kind === 'manual') {
      const d = chunkMap.get(s.id);
      if (!d) continue;
      sources.push({
        kind: 'manual',
        id: s.id,
        title: d.title,
        path: d.path,
        text: d.text,
        warnings: d.warnings,
        related: d.related ?? [],
        similarity: s.similarity,
        rrf: s.rrf,
      });
    } else {
      const d = articleMap.get(s.id);
      if (!d) continue;
      sources.push({
        kind: 'article',
        id: s.id,
        title: d.question,
        path: 'Support knowledge base',
        text: `Q: ${d.question}\nA: ${d.answer}`,
        warnings: [],
        related: [],
        similarity: s.similarity,
        rrf: s.rrf,
      });
    }
  }
  return {
    sources,
    bestSimilarity: Math.max(0, ...sources.map((s) => s.similarity)),
    isDemoSource,
  };
}
