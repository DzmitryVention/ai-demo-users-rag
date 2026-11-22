import { describe, expect, it } from 'vitest';
import { chunkPage, loadManual, parseBlocks, parseFrontMatter, warningsOf } from './manual.ts';

describe('demo manual', () => {
  it('loads all chapters and pages with unique keys and resolvable links', async () => {
    const manual = await loadManual();
    expect(manual.meta.licenceRef).toBe('own-content');
    expect(manual.meta.chapters).toHaveLength(7);
    expect(manual.pages.length).toBeGreaterThanOrEqual(40);
    const keys = new Set(manual.pages.map((p) => p.key));
    const unresolved = manual.pages.flatMap((p) => p.links.filter((l) => !keys.has(l)));
    expect(unresolved).toEqual([]);
  });

  it('has warnings and keeps every chunk within limits', async () => {
    const manual = await loadManual();
    const warnings = manual.pages.flatMap(warningsOf);
    expect(warnings.filter((w) => w.kind === 'warning').length).toBeGreaterThanOrEqual(25);
    for (const page of manual.pages) {
      for (const chunk of chunkPage(page, `X › ${page.title}`)) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(600);
        expect(chunk.text.startsWith(`X › ${page.title}`)).toBe(true);
      }
    }
  });

  it('produces a stable content hash', async () => {
    const [a, b] = await Promise.all([loadManual(), loadManual()]);
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe('parsing', () => {
  it('parses front-matter scalars and lists', () => {
    const { data, body } = parseFrontMatter('---\nkey: a-b\nlinks: [x, y]\n---\nBody');
    expect(data).toEqual({ key: 'a-b', links: ['x', 'y'] });
    expect(body).toBe('Body');
  });

  it('splits paragraphs, lists and callouts', () => {
    const blocks = parseBlocks(
      'Intro line\ncontinues.\n\n- one\n- two\n\n> **WARNING:** Hot engine.\n\n> **NOTE:** Recycle oil.',
    );
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Intro line continues.' },
      { type: 'list', text: '- one\n- two' },
      { type: 'callout', kind: 'warning', text: 'Hot engine.' },
      { type: 'callout', kind: 'note', text: 'Recycle oil.' },
    ]);
  });

  it('never splits a block and starts a new chunk when the target is exceeded', () => {
    const long = 'word '.repeat(300).trim();
    const page = {
      key: 'p',
      chapterKey: 'c',
      title: 'T',
      ordinal: 1,
      links: [],
      blocks: [
        { type: 'paragraph' as const, text: long },
        { type: 'callout' as const, kind: 'warning' as const, text: 'Careful.' },
      ],
    };
    const chunks = chunkPage(page, 'C › T', { targetTokens: 350 });
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.text).toContain('⚠ WARNING: Careful.');
  });
});
