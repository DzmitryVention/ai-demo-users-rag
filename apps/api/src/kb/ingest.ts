/**
 * Knowledge-base ingestion (specs/002 knowledge-ingestion.md § Pipeline):
 * load → chunk → embed → store in one transaction with an atomic edition swap.
 * Idempotent: an unchanged manual (same content hash) is a no-op.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Embedder } from '../bot/llm.ts';
import type { Database } from '../db/client.ts';
import { kbChunks, kbLinks, kbSections, kbSources } from '../db/schema.ts';
import { chunkPage, loadManual, warningsOf, type Chunk } from './manual.ts';

export interface IngestReport {
  status: 'unchanged' | 'ingested';
  sourceId: string;
  sections: number;
  chunks: number;
  links: number;
  unresolvedLinks: string[];
  durationMs: number;
}

/** Third-party content needs a documented licence (spec D-Q1). Our own content is fine. */
function assertLicence(licenceRef: string) {
  if (licenceRef === 'own-content') return;
  if (process.env['KB_SOURCE_LICENSE_CONFIRMED'] !== 'true' || !process.env['KB_LICENCE_REF']) {
    throw new Error(
      `Refusing to ingest third-party content (licenceRef=${licenceRef}). Set KB_SOURCE_LICENSE_CONFIRMED=true and KB_LICENCE_REF.`,
    );
  }
}

export async function ingestManual(
  db: Database,
  embedder: Pick<Embedder, 'embedDocuments'>,
  dir?: string,
): Promise<IngestReport> {
  const started = Date.now();
  const manual = await loadManual(dir);
  assertLicence(manual.meta.licenceRef);

  const [existing] = await db
    .select({ id: kbSources.id })
    .from(kbSources)
    .where(and(eq(kbSources.status, 'active'), eq(kbSources.contentHash, manual.contentHash)));
  if (existing) {
    return {
      status: 'unchanged',
      sourceId: existing.id,
      sections: 0,
      chunks: 0,
      links: 0,
      unresolvedLinks: [],
      durationMs: Date.now() - started,
    };
  }

  // Chunk first (pure), then embed (network), then write everything in one transaction.
  const chapterTitle = new Map(manual.meta.chapters.map((c) => [c.key, c.title]));
  const pageChunks: { pageKey: string; breadcrumb: string; chunks: Chunk[] }[] = manual.pages.map(
    (page) => {
      const breadcrumb = `${chapterTitle.get(page.chapterKey)} › ${page.title}`;
      return { pageKey: page.key, breadcrumb, chunks: chunkPage(page, breadcrumb) };
    },
  );
  const allChunks = pageChunks.flatMap((p) =>
    p.chunks.map((c) => ({ ...c, breadcrumb: p.breadcrumb })),
  );
  const embeddings = await embedder.embedDocuments(
    allChunks.map((c) => ({ title: c.breadcrumb, text: c.text })),
  );

  const pageKeys = new Set(manual.pages.map((p) => p.key));
  const unresolvedLinks = manual.pages.flatMap((p) =>
    p.links.filter((l) => !pageKeys.has(l)).map((l) => `${p.key} → ${l}`),
  );

  const report = await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(kbSources)
      .values({
        title: manual.meta.title,
        edition: manual.meta.edition,
        language: manual.meta.language,
        originUrl: manual.meta.officialManualUrl,
        contentHash: manual.contentHash,
        licenceRef: manual.meta.licenceRef,
        isDemo: manual.meta.licenceRef === 'own-content',
        status: 'ingesting',
      })
      .returning({ id: kbSources.id });
    const sourceId = source!.id;

    const sectionIds = new Map<string, string>();
    for (const [i, chapter] of manual.meta.chapters.entries()) {
      const [row] = await tx
        .insert(kbSections)
        .values({
          sourceId,
          level: 1,
          ordinal: i + 1,
          externalKey: `chapter:${chapter.key}`,
          title: chapter.title,
          path: chapter.title,
        })
        .returning({ id: kbSections.id });
      sectionIds.set(`chapter:${chapter.key}`, row!.id);
    }
    for (const page of manual.pages) {
      const [row] = await tx
        .insert(kbSections)
        .values({
          sourceId,
          parentId: sectionIds.get(`chapter:${page.chapterKey}`),
          level: 2,
          ordinal: page.ordinal,
          externalKey: page.key,
          title: page.title,
          path: `${chapterTitle.get(page.chapterKey)} › ${page.title}`,
          warnings: warningsOf(page),
        })
        .returning({ id: kbSections.id });
      sectionIds.set(page.key, row!.id);
    }

    const links = manual.pages.flatMap((p) =>
      p.links
        .filter((l) => pageKeys.has(l) && l !== p.key)
        .map((l) => ({ fromSectionId: sectionIds.get(p.key)!, toSectionId: sectionIds.get(l)! })),
    );
    if (links.length) await tx.insert(kbLinks).values(links).onConflictDoNothing();

    const chunkRows = allChunks.map((c, i) => ({
      sectionId: sectionIds.get(c.pageKey)!,
      ordinal: c.ordinal,
      text: c.text,
      tokenCount: c.tokenCount,
      embedding: embeddings[i]!,
      contentHash: c.contentHash,
    }));
    for (let i = 0; i < chunkRows.length; i += 100) {
      await tx.insert(kbChunks).values(chunkRows.slice(i, i + 100));
    }

    // Atomic swap: retire the previous edition, then activate the new one.
    await tx.update(kbSources).set({ status: 'retired' }).where(eq(kbSources.status, 'active'));
    await tx
      .update(kbSources)
      .set({ status: 'active', ingestedAt: sql`now()` })
      .where(eq(kbSources.id, sourceId));

    return { sourceId, sections: sectionIds.size, chunks: chunkRows.length, links: links.length };
  });

  return { status: 'ingested', ...report, unresolvedLinks, durationMs: Date.now() - started };
}
