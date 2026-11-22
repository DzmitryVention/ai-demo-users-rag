/** Glue between HTTP routes, the task queue and the assistant pipeline. */
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.ts';
import { markQueuedIfEligible } from '../services/tickets.ts';
import type { Embedder, Llm } from './llm.ts';
import { DEMO_NOTICE, getBotSettings, purgeOldRuns, runBot, summarizeTicket } from './pipeline.ts';
import type { BotQueue, BotTask, TaskAuthVerifier } from './queue.ts';

export interface BotRuntime {
  /** null when GEMINI_API_KEY is not configured: the assistant stays off. */
  ai: (Llm & Embedder) | null;
  queue: BotQueue;
  /** null disables the internal task endpoint. */
  taskVerifier: TaskAuthVerifier | null;
  demoNotice: string;
}

export const disabledBotRuntime = (): BotRuntime => ({
  ai: null,
  queue: { enqueue: async () => undefined },
  taskVerifier: null,
  demoNotice: DEMO_NOTICE,
});

/** Called after a user writes in a ticket: queue the assistant if it may answer. */
export async function onUserMessage(
  runtime: BotRuntime,
  db: Database,
  log: FastifyBaseLogger,
  ticketId: string,
  messageId: string,
) {
  if (!runtime.ai) return;
  try {
    const settings = await getBotSettings(db);
    if (settings.mode !== 'live') return;
    if (await markQueuedIfEligible(db, ticketId)) {
      await runtime.queue.enqueue({ kind: 'run', ticketId, messageId });
    }
  } catch (err) {
    // Never fail the user's request because of the assistant; the ticket stays for humans.
    log.error({ err, ticketId }, 'failed to enqueue assistant run');
  }
}

/** Called when a ticket becomes answered/closed: refresh its history summary. */
export async function onTicketResolved(
  runtime: BotRuntime,
  log: FastifyBaseLogger,
  ticketId: string,
) {
  if (!runtime.ai) return;
  try {
    await runtime.queue.enqueue({ kind: 'summary', ticketId });
  } catch (err) {
    log.warn({ err, ticketId }, 'failed to enqueue summary');
  }
}

export async function handleTask(
  runtime: BotRuntime,
  db: Database,
  log: FastifyBaseLogger,
  task: BotTask,
) {
  if (!runtime.ai) return;
  const deps = { db, llm: runtime.ai, embedder: runtime.ai, log, demoNotice: runtime.demoNotice };
  if (task.kind === 'run') {
    await runBot(deps, task.ticketId, task.messageId);
    // An answered ticket gets a fresh summary for the owner's future requests.
    await summarizeTicket(deps, task.ticketId).catch((err: unknown) =>
      log.warn({ err, ticketId: task.ticketId }, 'summary failed'),
    );
    await purgeOldRuns(db).catch(() => undefined);
  } else {
    await summarizeTicket(deps, task.ticketId);
  }
}
