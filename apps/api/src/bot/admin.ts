/** Admin-facing operations of the assistant (specs/002 US-3, US-4, US-5, US-7). */
import type {
  BotOverview,
  BotRunListResponse,
  BotSettings,
  KbArticle,
  UpdateKbArticleInput,
} from '@app/shared';
import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { queryRows, type Database } from '../db/client.ts';
import {
  botRuns,
  botSettings,
  kbArticles,
  kbChunks,
  kbSections,
  kbSources,
  ticketMessages,
  tickets,
} from '../db/schema.ts';
import { AppError, notFound } from '../errors.ts';
import { maskPii, sanitizeInput } from './guardrails.ts';
import type { Embedder, Llm } from './llm.ts';
import { getBotSettings, monthSpendUsd } from './pipeline.ts';

const toSettings = (row: Awaited<ReturnType<typeof getBotSettings>>): BotSettings => ({
  mode: row.mode,
  personaName: row.personaName,
  minRelevance: row.minRelevance,
  maxTurnsPerTicket: row.maxTurnsPerTicket,
  maxRunsPerUserPerDay: row.maxRunsPerUserPerDay,
  monthlyBudgetUsd: row.monthlyBudgetUsd,
});

export async function readSettings(db: Database): Promise<BotSettings> {
  return toSettings(await getBotSettings(db));
}

export async function updateSettings(
  db: Database,
  input: BotSettings,
  adminId: string,
  aiConfigured: boolean,
): Promise<BotSettings> {
  if (input.mode === 'live' && !aiConfigured) {
    throw new AppError(409, 'AI_NOT_CONFIGURED', 'The AI provider is not configured on the server');
  }
  await getBotSettings(db); // ensure the row exists
  const [row] = await db
    .update(botSettings)
    .set({ ...input, updatedBy: adminId, updatedAt: new Date() })
    .where(eq(botSettings.id, 1))
    .returning();
  return toSettings(row!);
}

export async function getOverview(db: Database): Promise<BotOverview> {
  const since = sql`now() - interval '30 days'`;
  const [settings, spend, pending, runs, feedback, reasons, kb] = await Promise.all([
    readSettings(db),
    monthSpendUsd(db),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(eq(tickets.status, 'pending_human')),
    db
      .select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${botRuns.decision} = 'answered')::int`,
        escalated: sql<number>`count(*) filter (where ${botRuns.decision} = 'escalated')::int`,
      })
      .from(botRuns)
      .where(gte(botRuns.createdAt, since)),
    db
      .select({
        helpful: sql<number>`count(*) filter (where ${ticketMessages.feedback} = 'helpful')::int`,
        notHelpful: sql<number>`count(*) filter (where ${ticketMessages.feedback} = 'not_helpful')::int`,
      })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.authorRole, 'bot'), gte(ticketMessages.createdAt, since))),
    db
      .select({ reason: botRuns.escalationReason, count: sql<number>`count(*)::int` })
      .from(botRuns)
      .where(and(gte(botRuns.createdAt, since), isNotNull(botRuns.escalationReason)))
      .groupBy(botRuns.escalationReason)
      .orderBy(desc(sql`count(*)`)),
    queryRows<{
      title: string;
      edition: string;
      sections: number;
      chunks: number;
      ingested_at: Date | string;
    }>(
      db,
      sql`select s.title, s.edition, s.ingested_at,
                 (select count(*)::int from ${kbSections} where source_id = s.id) as sections,
                 (select count(*)::int from ${kbChunks} c join ${kbSections} k on k.id = c.section_id where k.source_id = s.id) as chunks
          from ${kbSources} s where s.status = 'active' limit 1`,
    ),
  ]);
  const kbRow = kb[0];
  return {
    settings,
    monthSpendUsd: Number(spend.toFixed(4)),
    pendingHuman: pending[0]?.n ?? 0,
    runs30d: {
      total: runs[0]?.total ?? 0,
      answered: runs[0]?.answered ?? 0,
      escalated: runs[0]?.escalated ?? 0,
      helpful: feedback[0]?.helpful ?? 0,
      notHelpful: feedback[0]?.notHelpful ?? 0,
    },
    escalationReasons: reasons.map((r) => ({ reason: r.reason ?? 'unknown', count: r.count })),
    knowledgeBase: kbRow
      ? {
          title: kbRow.title,
          edition: kbRow.edition,
          sections: kbRow.sections,
          chunks: kbRow.chunks,
          ingestedAt: new Date(kbRow.ingested_at).toISOString(),
        }
      : null,
  };
}

export async function listRuns(
  db: Database,
  opts: { page: number; pageSize: number; ticketId?: string | undefined },
): Promise<BotRunListResponse> {
  const where = opts.ticketId ? eq(botRuns.ticketId, opts.ticketId) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select({ run: botRuns, subject: tickets.subject })
      .from(botRuns)
      .innerJoin(tickets, eq(tickets.id, botRuns.ticketId))
      .where(where)
      .orderBy(desc(botRuns.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(botRuns)
      .where(where),
  ]);
  return {
    items: rows.map(({ run, subject }) => ({
      id: run.id,
      ticketId: run.ticketId,
      ticketSubject: subject,
      decision: run.decision,
      escalationReason: run.escalationReason,
      sources: (run.retrieved ?? []).map((s) => ({ kind: s.kind, title: s.title, score: s.score })),
      guardrails: run.guardrails ?? {},
      modelAnswer: run.modelAnswer,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd,
      latencyMs: run.latencyMs,
      createdAt: run.createdAt.toISOString(),
    })),
    total: count?.n ?? 0,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

// ------------------------------------------------------------------ knowledge articles

const toArticle = (row: typeof kbArticles.$inferSelect): KbArticle => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  status: row.status,
  sourceTicketId: row.sourceTicketId,
  createdAt: row.createdAt.toISOString(),
  approvedAt: row.approvedAt?.toISOString() ?? null,
});

export async function listArticles(db: Database): Promise<KbArticle[]> {
  const rows = await db
    .select()
    .from(kbArticles)
    .orderBy(
      asc(sql`case ${kbArticles.status} when 'draft' then 0 when 'approved' then 1 else 2 end`),
      desc(kbArticles.createdAt),
    );
  return rows.map(toArticle);
}

/** Drafts an anonymised article from a resolved ticket (AC-4.4). Never auto-approved. */
export async function createArticleFromTicket(
  db: Database,
  llm: Llm,
  ticketId: string,
  adminId: string,
): Promise<KbArticle> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw notFound('Ticket');
  if (ticket.status !== 'answered' && ticket.status !== 'closed') {
    throw new AppError(
      409,
      'TICKET_NOT_RESOLVED',
      'Only answered or closed requests can become articles',
    );
  }
  const messages = await db
    .select({ role: ticketMessages.authorRole, body: ticketMessages.body })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.visibility, 'public')))
    .orderBy(asc(ticketMessages.createdAt));
  const pii = new Map<string, string>();
  const thread = [
    `Subject: ${maskPii(sanitizeInput(ticket.subject), pii).masked}`,
    ...messages.map(
      (m) =>
        `[${m.role === 'user' ? 'customer' : 'support'}] ${maskPii(sanitizeInput(m.body), pii).masked}`,
    ),
  ].join('\n\n');
  const draft = await llm.draftArticle(thread.slice(0, 12_000));
  const [row] = await db
    .insert(kbArticles)
    .values({
      question: maskPii(draft.question).masked.slice(0, 500),
      answer: maskPii(draft.answer).masked.slice(0, 3000),
      sourceTicketId: ticketId,
      status: 'draft',
      createdBy: adminId,
    })
    .returning();
  return toArticle(row!);
}

/** Edits / approves / archives an article. Approval computes its embedding. */
export async function updateArticle(
  db: Database,
  embedder: Embedder | null,
  id: string,
  input: UpdateKbArticleInput,
  adminId: string,
): Promise<KbArticle> {
  const [current] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
  if (!current) throw notFound('Article');
  const question = input.question ?? current.question;
  const answer = input.answer ?? current.answer;
  const status = input.status ?? current.status;
  const contentChanged = question !== current.question || answer !== current.answer;

  let embedding = contentChanged ? null : current.embedding;
  if (status === 'approved' && (embedding === null || contentChanged)) {
    if (!embedder) throw new AppError(409, 'AI_NOT_CONFIGURED', 'Embeddings are not configured');
    const [vector] = await embedder.embedDocuments([
      { title: question, text: `Q: ${question}\nA: ${answer}` },
    ]);
    embedding = vector ?? null;
  }
  const [row] = await db
    .update(kbArticles)
    .set({
      question,
      answer,
      status,
      embedding,
      ...(status === 'approved' && current.status !== 'approved'
        ? { approvedBy: adminId, approvedAt: new Date() }
        : {}),
    })
    .where(eq(kbArticles.id, id))
    .returning();
  return toArticle(row!);
}
