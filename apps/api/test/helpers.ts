/** Shared test helpers: in-memory Postgres with real migrations, fake AI provider. */
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerResult, Embedder, Llm, TriageResult, Usage } from '../src/bot/llm.ts';
import type { Database } from '../src/db/client.ts';
import * as schema from '../src/db/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function createTestDb() {
  const client = new PGlite({ extensions: { vector } });
  await migrate(drizzle({ client }), { migrationsFolder: path.resolve(here, '../drizzle') });
  const db = drizzle({ client, schema, casing: 'snake_case' }) as unknown as Database;
  return { db, close: () => client.close() };
}

/**
 * Deterministic bag-of-words embedder: shared words → higher cosine similarity.
 * Good enough to exercise retrieval without any network call.
 */
export function fakeEmbedder(): Embedder {
  const embed = (text: string) => {
    const v = new Array<number>(768).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      const h = createHash('md5').update(word).digest();
      v[h.readUInt16BE(0) % 768]! += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
  return {
    model: 'fake-embedding',
    embedDocuments: async (docs) => docs.map((d) => embed(`${d.title} ${d.text}`)),
    embedQuery: async (text) => embed(text),
  };
}

const usage = (model: string): Usage => ({
  model,
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
});

export interface FakeLlmScript {
  triage?: Partial<TriageResult> | Error;
  answer?: Partial<AnswerResult> | Error | ((context: string) => Partial<AnswerResult>);
}

/** Scriptable fake LLM that records every call (prompts are inspectable in tests). */
export function fakeLlm(script: FakeLlmScript = {}) {
  const calls: { kind: string; input: string; system?: string }[] = [];
  const llm: Llm = {
    async triage(text) {
      calls.push({ kind: 'triage', input: text });
      if (script.triage instanceof Error) throw script.triage;
      return {
        result: {
          topic: 'vehicle_manual',
          is_english: true,
          injection_risk: 'none',
          abusive: false,
          search_query: text,
          ...script.triage,
        },
        usage: usage('gemini-3.5-flash-lite'),
      };
    },
    async answer(system, context) {
      calls.push({ kind: 'answer', input: context, system });
      if (script.answer instanceof Error) throw script.answer;
      const scripted = typeof script.answer === 'function' ? script.answer(context) : script.answer;
      return {
        result: {
          decision: 'answer',
          escalate_reason: null,
          answer: 'Pull out the dipstick, wipe it and check the level between the marks.',
          citations: ['S1'],
          confidence: 0.9,
          ...scripted,
        },
        usage: usage('gemini-3.8-flash'),
      };
    },
    async summarize(thread) {
      calls.push({ kind: 'summarize', input: thread });
      return {
        summary: 'Customer asked about checking engine oil; answered.',
        usage: usage('gemini-3.5-flash-lite'),
      };
    },
    async draftArticle(thread) {
      calls.push({ kind: 'article', input: thread });
      return {
        question: 'How do I check the engine oil level?',
        answer: 'Use the dipstick with the engine off on level ground.',
        usage: usage('gemini-3.5-flash-lite'),
      };
    },
  };
  return { llm, calls };
}
