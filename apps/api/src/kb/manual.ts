/**
 * Loads the demo owner's guide (apps/api/kb/demo-duster-manual) into a document tree
 * and splits it into retrieval chunks (specs/002 knowledge-ingestion.md).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManualMeta {
  title: string;
  edition: string;
  language: string;
  licenceRef: string;
  notice: string;
  officialManualUrl: string;
  chapters: { key: string; title: string }[];
}

export interface Warning {
  kind: 'warning' | 'note';
  text: string;
}

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; text: string }
  | { type: 'callout'; kind: Warning['kind']; text: string };

export interface ManualPage {
  key: string;
  chapterKey: string;
  title: string;
  ordinal: number;
  links: string[];
  blocks: Block[];
}

export interface Manual {
  meta: ManualMeta;
  pages: ManualPage[];
  contentHash: string;
}

export interface Chunk {
  pageKey: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  contentHash: string;
}

/** `KB_MANUAL_DIR` is set in the container image; the fallback works from `src/kb`. */
export const DEFAULT_MANUAL_DIR =
  process.env['KB_MANUAL_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kb/demo-duster-manual');

/** Rough token estimate (≈ 4 characters per token for English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Minimal front-matter parser: `key: value` and `key: [a, b]` lines only. */
export function parseFrontMatter(source: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) throw new Error('Missing front-matter');
  const data: Record<string, string | string[]> = {};
  for (const line of match[1]!.split('\n')) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    const list = /^\[(.*)\]$/.exec(raw);
    data[key] = list
      ? list[1]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : raw;
  }
  return { data, body: source.slice(match[0].length) };
}

/** Splits Markdown into paragraphs, lists and WARNING/NOTE callouts. */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  for (const raw of cleaned.split(/\n\s*\n/)) {
    const text = raw.trim();
    if (!text) continue;
    const callout = /^>\s*\*\*(WARNING|NOTE):\*\*\s*([\s\S]*)$/.exec(text);
    if (callout) {
      blocks.push({
        type: 'callout',
        kind: callout[1] === 'WARNING' ? 'warning' : 'note',
        text: callout[2]!.replace(/\n>\s?/g, ' ').trim(),
      });
    } else if (/^(\s*[-*]\s|\s*\d+\.\s)/.test(text)) {
      blocks.push({ type: 'list', text });
    } else {
      blocks.push({ type: 'paragraph', text: text.replace(/\n/g, ' ') });
    }
  }
  return blocks;
}

export async function loadManual(dir = DEFAULT_MANUAL_DIR): Promise<Manual> {
  const metaRaw = await readFile(path.join(dir, 'manual.json'), 'utf8');
  const meta = JSON.parse(metaRaw) as ManualMeta;
  const chapterKeys = new Set(meta.chapters.map((c) => c.key));
  const pages: ManualPage[] = [];
  const hashParts = [metaRaw];

  for (const chapter of meta.chapters) {
    const files = (await readdir(path.join(dir, chapter.key)))
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const file of files) {
      const source = await readFile(path.join(dir, chapter.key, file), 'utf8');
      hashParts.push(`${chapter.key}/${file}\n${source}`);
      const { data, body } = parseFrontMatter(source);
      const key = String(data['key'] ?? '');
      const title = String(data['title'] ?? '');
      if (!key || !title) throw new Error(`${chapter.key}/${file}: key and title are required`);
      pages.push({
        key,
        chapterKey: chapter.key,
        title,
        ordinal: Number(data['ordinal'] ?? 0),
        links: Array.isArray(data['links']) ? data['links'] : [],
        blocks: parseBlocks(body),
      });
    }
  }

  const keys = new Set<string>();
  for (const page of pages) {
    if (!chapterKeys.has(page.chapterKey)) throw new Error(`Unknown chapter ${page.chapterKey}`);
    if (keys.has(page.key)) throw new Error(`Duplicate page key ${page.key}`);
    keys.add(page.key);
  }
  return { meta, pages, contentHash: sha256(hashParts.join('\n---\n')) };
}

export const warningsOf = (page: ManualPage): Warning[] =>
  page.blocks.flatMap((b) => (b.type === 'callout' ? [{ kind: b.kind, text: b.text }] : []));

const renderBlock = (block: Block) =>
  block.type === 'callout' ? `> ⚠ ${block.kind.toUpperCase()}: ${block.text}` : block.text;

/**
 * Structure-aware chunking: blocks are never split; chunks never span pages; each chunk
 * starts with its breadcrumb so it is understandable on its own.
 */
export function chunkPage(
  page: ManualPage,
  breadcrumb: string,
  opts: { targetTokens?: number; maxTokens?: number } = {},
): Chunk[] {
  const target = opts.targetTokens ?? 350;
  const max = opts.maxTokens ?? 600;
  const header = `${breadcrumb}\n\n`;
  const chunks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length) chunks.push(header + current.join('\n\n'));
    current = [];
  };
  for (const block of page.blocks) {
    const rendered = renderBlock(block);
    const projected = estimateTokens(header + [...current, rendered].join('\n\n'));
    if (current.length && projected > target) flush();
    current.push(rendered);
  }
  flush();

  return chunks.map((text, ordinal) => {
    if (estimateTokens(text) > max) {
      throw new Error(`Chunk ${page.key}#${ordinal} exceeds ${max} tokens — split the page`);
    }
    return {
      pageKey: page.key,
      ordinal,
      text,
      tokenCount: estimateTokens(text),
      contentHash: sha256(text),
    };
  });
}
