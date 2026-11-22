/**
 * The assistant pipeline (specs/002 plan § Architecture, security.md § Layers).
 * Every failure path ends in a human hand-off (NFR-1 fail closed).
 */
import type { EscalationReason } from '@app/shared';
import { and, asc, desc, eq, gte, lt, ne, sql, sum } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { queryRows, type Database, type DbExecutor } from '../db/client.ts';
import {
  botRuns,
  botSettings,
  ticketMessages,
  tickets,
  ticketSummaries,
  type BotSettingsRow,
} from '../db/schema.ts';
import {
  checkAnswer,
  looksLikeInjection,
  maskPii,
  newCanary,
  newNonce,
  sanitizeInput,
  unmaskPii,
} from './guardrails.ts';
import {
  LlmBlockedError,
  LlmBudgetError,
  type AnswerResult,
  type Embedder,
  type Llm,
  type TriageResult,
  type Usage,
} from './llm.ts';
import { answerSystemPrompt, buildContext, PROMPT_VERSION } from './prompt.ts';
import { retrieve, type RetrievalResult } from './retriever.ts';

export interface BotDeps {
  db: Database;
  llm: Llm;
  embedder: Embedder;
  log: FastifyBaseLogger;
  /** Shown under answers built on the demo knowledge base (spec AC-5.4). */
  demoNotice: string;
}

export const DEMO_NOTICE =
  "Demo knowledge base — not official Renault information. Check your vehicle's owner's manual.";

const HANDOFF_MESSAGES: Partial<Record<EscalationReason, string>> & { default: string } = {
  default:
    "Thanks for your message. I've passed your request to our support team — a person will reply here as soon as possible.",
  unsupported_language:
    "Thanks for your message. I can only help in English, so I've passed your request to our support team — a person will reply here as soon as possible.",
  max_turns:
    "I've passed this conversation to our support team so a person can help you further. They will reply here as soon as possible.",
};

// ------------------------------------------------------------------ settings & accounting

export async function getBotSettings(db: DbExecutor): Promise<BotSettingsRow> {
  const [row] = await db.select().from(botSettings).where(eq(botSettings.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(botSettings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.select().from(botSettings).where(eq(botSettings.id, 1)))[0]!;
}

export const startOfMonthUtc = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function monthSpendUsd(db: DbExecutor, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sum(botRuns.costUsd) })
    .from(botRuns)
    .where(gte(botRuns.createdAt, startOfMonthUtc(now)));
  return Number(row?.total ?? 0);
}

async function runsToday(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(botRuns)
    .where(
      and(
        eq(botRuns.userId, userId),
        ne(botRuns.decision, 'skipped'),
        gte(botRuns.createdAt, sql`now() - interval '1 day'`),
      ),
    );
  return row?.n ?? 0;
}

// ------------------------------------------------------------------ scoped context (RLS)

interface ScopedContext {
  firstName: string | null;
  thread: { role: 'customer' | 'support'; text: string; messageId: string }[];
  history: string[];
  retrieval: RetrievalResult;
}

/**
 * Reads everything the model may see as the restricted `helpdesk_bot` role with
 * `app.requester_id` set (security L4). Even a bug here cannot read other users' rows.
 */
async function loadScopedContext(
  db: Database,
  requesterId: string,
  ticketId: string,
  query: { embedding: number[]; text: string },
): Promise<ScopedContext> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role helpdesk_bot`);
    await tx.execute(sql`select set_config('app.requester_id', ${requesterId}, true)`);

    const [requester] = await queryRows<{ first_name: string }>(
      tx,
      sql`select first_name from bot_requester`,
    );
    const messages = await tx
      .select({ id: ticketMessages.id, role: ticketMessages.authorRole, body: ticketMessages.body })
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));
    const summaries = await tx
      .select({ summary: ticketSummaries.summary })
      .from(ticketSummaries)
      .where(ne(ticketSummaries.ticketId, ticketId))
      .orderBy(desc(ticketSummaries.updatedAt))
      .limit(5);
    const retrieval = await retrieve(tx, query);

    return {
      firstName: requester?.first_name ?? null,
      thread: messages.map((m) => ({
        role: m.role === 'user' ? ('customer' as const) : ('support' as const),
        text: m.body,
        messageId: m.id,
      })),
      history: summaries.map((s) => s.summary),
      retrieval,
    };
  });
}

// ------------------------------------------------------------------ outcome helpers

interface RunRecord {
  decision: 'answered' | 'escalated' | 'skipped';
  reason?: EscalationReason | null;
  triage?: TriageResult | null;
  retrieval?: RetrievalResult | null;
  aliases?: Map<string, RetrievalResult['sources'][number]>;
  guardrails: Record<string, string>;
  usages: Usage[];
  started: number;
}

async function insertRun(
  db: DbExecutor,
  ticketId: string,
  messageId: string,
  userId: string,
  r: RunRecord,
) {
  const answerUsage = r.usages.find((u) => u.model.includes('flash') && !u.model.includes('lite'));
  const triageUsage = r.usages.find((u) => u.model.includes('lite'));
  const [row] = await db
    .insert(botRuns)
    .values({
      ticketId,
      messageId,
      userId,
      decision: r.decision,
      escalationReason: r.reason ?? null,
      triage: r.triage ?? null,
      retrieved:
        r.retrieval?.sources.map((s) => ({
          kind: s.kind,
          id: s.id,
          title: s.title,
          score: Number(s.similarity.toFixed(4)),
        })) ?? [],
      guardrails: r.guardrails,
      modelAnswer: answerUsage?.model ?? null,
      modelTriage: triageUsage?.model ?? null,
      promptVersion: PROMPT_VERSION,
      inputTokens: r.usages.reduce((a, u) => a + u.inputTokens, 0),
      outputTokens: r.usages.reduce((a, u) => a + u.outputTokens, 0),
      costUsd: r.usages.reduce((a, u) => a + u.costUsd, 0),
      latencyMs: Date.now() - r.started,
    })
    .onConflictDoNothing()
    .returning({ id: botRuns.id });
  return row?.id ?? null;
}

async function escalate(
  deps: BotDeps,
  settings: BotSettingsRow,
  ticket: { id: string; userId: string },
  messageId: string,
  reason: EscalationReason,
  run: Omit<RunRecord, 'decision' | 'reason'>,
  draft?: { text: string; citations: { kind: 'manual' | 'article'; title: string }[] },
) {
  await deps.db.transaction(async (tx) => {
    const runId = await insertRun(tx, ticket.id, messageId, ticket.userId, {
      ...run,
      decision: 'escalated',
      reason,
    });
    if (runId === null) return; // another worker already handled this message
    if (draft?.text) {
      await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        authorId: null,
        authorRole: 'bot',
        personaName: settings.personaName,
        visibility: 'internal',
        body: draft.text,
        citations: draft.citations,
        botRunId: runId,
      });
    }
    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorId: null,
      authorRole: 'bot',
      personaName: settings.personaName,
      visibility: 'public',
      body: HANDOFF_MESSAGES[reason] ?? HANDOFF_MESSAGES.default,
      citations: [],
      botRunId: runId,
    });
    await tx
      .update(tickets)
      .set({
        status: 'pending_human',
        botState: 'disabled',
        escalationReason: reason,
        escalatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));
  });
  deps.log.info({ ticketId: ticket.id, reason }, 'bot escalated');
}

async function skip(deps: BotDeps, ticketId: string, why: string, resetState: boolean) {
  if (resetState) {
    await deps.db
      .update(tickets)
      .set({ botState: 'idle' })
      .where(and(eq(tickets.id, ticketId), ne(tickets.botState, 'disabled')));
  }
  deps.log.info({ ticketId, why }, 'bot skipped');
}

// ------------------------------------------------------------------ main entry

/** Processes one user message. Idempotent per message id. */
export async function runBot(deps: BotDeps, ticketId: string, messageId: string): Promise<void> {
  const started = Date.now();
  const { db, llm, embedder } = deps;
  const guardrails: Record<string, string> = {};
  const usages: Usage[] = [];
  let triage: TriageResult | null = null;
  let retrieval: RetrievalResult | null = null;

  const [already] = await db
    .select({ id: botRuns.id })
    .from(botRuns)
    .where(eq(botRuns.messageId, messageId));
  if (already) return;

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  const [message] = await db.select().from(ticketMessages).where(eq(ticketMessages.id, messageId));
  if (!ticket || !message || message.ticketId !== ticketId)
    return skip(deps, ticketId, 'not_found', false);
  if (message.authorRole !== 'user' || message.visibility !== 'public') {
    return skip(deps, ticketId, 'not_a_user_message', false);
  }

  const settings = await getBotSettings(db);
  // L0 eligibility
  if (settings.mode !== 'live') return skip(deps, ticketId, 'mode_off', true);
  if (
    ticket.botState === 'disabled' ||
    ticket.status === 'pending_human' ||
    ticket.status === 'closed'
  ) {
    return skip(deps, ticketId, 'bot_disabled_for_ticket', false);
  }
  // Only the latest user message is answered; older queued ones are skipped.
  const [latest] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.authorRole, 'user')))
    .orderBy(desc(ticketMessages.createdAt), desc(ticketMessages.id))
    .limit(1);
  if (latest?.id !== messageId) return skip(deps, ticketId, 'superseded', false);

  const base = { started, guardrails, usages };
  const owner = { id: ticket.id, userId: ticket.userId };

  if (ticket.botTurns >= settings.maxTurnsPerTicket) {
    return escalate(deps, settings, owner, messageId, 'max_turns', base);
  }
  if ((await runsToday(db, ticket.userId)) >= settings.maxRunsPerUserPerDay) {
    return escalate(deps, settings, owner, messageId, 'quota_exceeded', base);
  }
  if ((await monthSpendUsd(db)) >= settings.monthlyBudgetUsd) {
    guardrails['budget'] = 'exceeded';
    return escalate(deps, settings, owner, messageId, 'budget_exceeded', base);
  }

  await db.update(tickets).set({ botState: 'running' }).where(eq(tickets.id, ticketId));

  try {
    // L1 hygiene + L2 masking
    const pii = new Map<string, string>();
    const subject = maskPii(sanitizeInput(ticket.subject), pii).masked;
    const request = maskPii(sanitizeInput(message.body), pii).masked;
    guardrails['pii_masked'] = String(pii.size);

    // L3 heuristics + triage
    if (looksLikeInjection(`${subject}\n${request}`)) {
      guardrails['injection_heuristic'] = 'fail';
      await escalate(deps, settings, owner, messageId, 'injection_suspected', base);
      return;
    }
    guardrails['injection_heuristic'] = 'pass';

    const t = await llm.triage(`Subject: ${subject}\n\n${request}`);
    usages.push(t.usage);
    triage = t.result;
    if (!triage.is_english) {
      await escalate(deps, settings, owner, messageId, 'unsupported_language', {
        ...base,
        triage,
      });
      return;
    }
    if (triage.injection_risk === 'high') {
      await escalate(deps, settings, owner, messageId, 'injection_suspected', {
        ...base,
        triage,
      });
      return;
    }
    if (triage.abusive) {
      await escalate(deps, settings, owner, messageId, 'abusive', { ...base, triage });
      return;
    }
    if (triage.topic !== 'vehicle_manual') {
      await escalate(deps, settings, owner, messageId, 'out_of_scope', { ...base, triage });
      return;
    }

    // R retrieval (inside the RLS scope) + G4 relevance gate
    const searchText = triage.search_query || `${subject} ${request}`;
    const embedding = await embedder.embedQuery(searchText);
    const ctx = await loadScopedContext(db, ticket.userId, ticketId, {
      embedding,
      text: searchText,
    });
    retrieval = ctx.retrieval;
    guardrails['best_similarity'] = retrieval.bestSimilarity.toFixed(3);
    if (retrieval.sources.length === 0 || retrieval.bestSimilarity < settings.minRelevance) {
      await escalate(deps, settings, owner, messageId, 'no_relevant_source', {
        ...base,
        triage,
        retrieval,
      });
      return;
    }

    // L4 context bundle
    const aliases = new Map<string, (typeof retrieval.sources)[number]>();
    let s = 0;
    let a = 0;
    const sources = retrieval.sources.map((src) => {
      const alias = src.kind === 'manual' ? `S${++s}` : `A${++a}`;
      aliases.set(alias, src);
      return { ...src, alias };
    });
    const thread = ctx.thread
      .filter((m) => m.messageId !== messageId)
      .map((m) => ({ role: m.role, text: maskPii(sanitizeInput(m.text), pii).masked }))
      .slice(-12);
    const history = ctx.history.map((h) => maskPii(h, pii).masked);
    const canary = newCanary();
    const context = buildContext({
      nonce: newNonce(),
      firstName: ctx.firstName,
      subject,
      request,
      thread,
      history,
      sources,
    });

    // A answer
    let answer: AnswerResult;
    try {
      const r = await llm.answer(answerSystemPrompt(settings.personaName, canary), context);
      usages.push(r.usage);
      answer = r.result;
    } catch (err) {
      if (err instanceof LlmBlockedError) {
        guardrails['provider_filter'] = err.kind;
        await escalate(
          deps,
          settings,
          owner,
          messageId,
          err.kind === 'jailbreak' ? 'injection_suspected' : 'model_refusal',
          { ...base, triage, retrieval },
        );
        return;
      }
      throw err;
    }

    const citations = [...new Set(answer.citations)]
      .map((c) => aliases.get(c))
      .filter((x) => x !== undefined)
      .map((src) => ({ kind: src.kind, title: src.kind === 'manual' ? src.path : src.title }));
    const draft = answer.answer ? { text: answer.answer, citations } : undefined;

    if (answer.decision === 'escalate') {
      const reason: EscalationReason =
        answer.escalate_reason === 'out_of_scope' ||
        answer.escalate_reason === 'needs_account_access'
          ? 'out_of_scope'
          : answer.escalate_reason === 'unsafe'
            ? 'guardrail_failed'
            : 'no_relevant_source';
      await escalate(
        deps,
        settings,
        owner,
        messageId,
        reason,
        { ...base, triage, retrieval },
        draft,
      );
      return;
    }

    // L5 output validation
    const check = checkAnswer({
      answer: answer.answer ?? '',
      citations: answer.citations,
      confidence: answer.confidence,
      allowedAliases: new Set(aliases.keys()),
      canary,
    });
    guardrails['output'] = check.ok ? 'pass' : `fail:${check.rule}`;
    if (!check.ok) {
      await escalate(
        deps,
        settings,
        owner,
        messageId,
        'guardrail_failed',
        { ...base, triage, retrieval },
        draft,
      );
      return;
    }

    // P publish — placeholders are restored only with the requester's own values.
    const body = unmaskPii(answer.answer!.trim(), pii);
    await db.transaction(async (tx) => {
      const runId = await insertRun(tx, ticketId, messageId, ticket.userId, {
        ...base,
        decision: 'answered',
        triage,
        retrieval,
      });
      if (runId === null) return;
      await tx.insert(ticketMessages).values({
        ticketId,
        authorId: null,
        authorRole: 'bot',
        personaName: settings.personaName,
        visibility: 'public',
        body,
        citations,
        notice: retrieval?.isDemoSource ? deps.demoNotice : null,
        botRunId: runId,
      });
      await tx
        .update(tickets)
        .set({
          status: 'answered',
          botState: 'idle',
          botTurns: sql`${tickets.botTurns} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId));
    });
    deps.log.info({ ticketId, sources: citations.length }, 'bot answered');
  } catch (err) {
    if (err instanceof LlmBudgetError) {
      guardrails['budget'] = 'provider_credits_depleted';
      await escalate(deps, settings, owner, messageId, 'budget_exceeded', {
        ...base,
        triage,
        retrieval,
      });
      return;
    }
    deps.log.error({ err, ticketId }, 'bot pipeline failed');
    guardrails['error'] = err instanceof Error ? err.name : 'unknown';
    await escalate(deps, settings, owner, messageId, 'error', { ...base, triage, retrieval });
  }
}

// ------------------------------------------------------------------ summaries (US-4 AC-4.2)

/** Creates/refreshes the PII-free summary of a ticket used as history for its owner. */
export async function summarizeTicket(deps: Pick<BotDeps, 'db' | 'llm' | 'log'>, ticketId: string) {
  const { db, llm } = deps;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket || (ticket.status !== 'answered' && ticket.status !== 'closed')) return;
  const messages = await db
    .select({ role: ticketMessages.authorRole, body: ticketMessages.body })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.visibility, 'public')))
    .orderBy(asc(ticketMessages.createdAt));
  if (messages.length === 0) return;

  const pii = new Map<string, string>();
  const thread = [
    `Subject: ${maskPii(sanitizeInput(ticket.subject), pii).masked}`,
    ...messages.map(
      (m) =>
        `[${m.role === 'user' ? 'customer' : 'support'}] ${maskPii(sanitizeInput(m.body), pii).masked}`,
    ),
  ]
    .join('\n\n')
    .slice(0, 12_000);
  const { summary } = await llm.summarize(thread);
  // Mask again: the summary is stored and reused, so it must never hold personal data.
  const clean = maskPii(sanitizeInput(summary)).masked.replace(
    /\[(EMAIL|CARD|IBAN|VIN|PHONE|PLATE)_\d+\]/g,
    '[hidden]',
  );
  if (!clean) return;
  await db
    .insert(ticketSummaries)
    .values({ ticketId, userId: ticket.userId, summary: clean })
    .onConflictDoUpdate({
      target: ticketSummaries.ticketId,
      set: { summary: clean, updatedAt: new Date() },
    });
}

/** Deletes audit rows older than 90 days (spec D-Q9). Cheap thanks to the created_at index. */
export async function purgeOldRuns(db: DbExecutor) {
  await db.delete(botRuns).where(lt(botRuns.createdAt, sql`now() - interval '90 days'`));
}
