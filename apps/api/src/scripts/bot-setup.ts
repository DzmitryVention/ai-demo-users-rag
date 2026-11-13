/**
 * One-off / per-deploy assistant setup (Cloud Run job `helpdesk-bot-setup`):
 *  1. ingest the demo owner's guide into the knowledge base (no-op when unchanged);
 *  2. backfill history summaries for resolved tickets that have none (spec D-Q10);
 *  3. apply BOT_INITIAL_MODE once — never overrides a choice an admin has saved.
 * Requires DATABASE_URL and GEMINI_API_KEY.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import pino from 'pino';
import { createGeminiLlm } from '../bot/llm.ts';
import { summarizeTicket } from '../bot/pipeline.ts';
import { createDb } from '../db/client.ts';
import { botSettings, tickets, ticketSummaries } from '../db/schema.ts';
import { ingestManual } from '../kb/ingest.ts';

const log = pino({
  messageKey: 'message',
  formatters: { level: (l) => ({ severity: l.toUpperCase() }) },
});
const url = process.env['DATABASE_URL'];
const apiKey = process.env['GEMINI_API_KEY'];
if (!url || !apiKey) throw new Error('DATABASE_URL and GEMINI_API_KEY are required');

const ai = createGeminiLlm({
  apiKey,
  answerModel: process.env['BOT_MODEL_ANSWER'] ?? 'gemini-3.8-flash',
  triageModel: process.env['BOT_MODEL_TRIAGE'] ?? 'gemini-3.5-flash-lite',
  embedModel: process.env['BOT_MODEL_EMBED'] ?? 'gemini-embedding-2',
});
const handle = createDb(url, 2);
try {
  const report = await ingestManual(handle.db, ai);
  log.info({ ...report }, 'knowledge base ingestion');
  if (report.unresolvedLinks.length)
    log.warn({ unresolved: report.unresolvedLinks }, 'unresolved links');

  const missing = await handle.db
    .select({ id: tickets.id })
    .from(tickets)
    .leftJoin(ticketSummaries, eq(ticketSummaries.ticketId, tickets.id))
    .where(and(inArray(tickets.status, ['answered', 'closed']), isNull(ticketSummaries.ticketId)));
  let done = 0;
  for (const t of missing) {
    try {
      await summarizeTicket({ db: handle.db, llm: ai, log: log }, t.id);
      done++;
    } catch (err) {
      log.warn({ err, ticketId: t.id }, 'summary failed');
    }
  }
  log.info({ candidates: missing.length, summarised: done }, 'summary backfill');

  if (process.env['BOT_INITIAL_MODE'] === 'live') {
    const switched = await handle.db
      .update(botSettings)
      .set({ mode: 'live', updatedAt: new Date() })
      .where(and(eq(botSettings.id, 1), isNull(botSettings.updatedBy), eq(botSettings.mode, 'off')))
      .returning({ id: botSettings.id });
    log.info({ switchedOn: switched.length > 0 }, 'initial assistant mode');
  }
} finally {
  await handle.close();
}
