import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/** Embedding size of `gemini-embedding-2` with `outputDimensionality: 768`. */
export const EMBEDDING_DIMENSIONS = 768;

export const ticketStatus = pgEnum('ticket_status', [
  'open',
  'answered',
  'pending_human',
  'closed',
]);
export const authorRole = pgEnum('author_role', ['user', 'admin', 'bot']);
export const botState = pgEnum('bot_state', ['idle', 'queued', 'running', 'disabled']);
export const escalationReason = pgEnum('escalation_reason', [
  'no_relevant_source',
  'out_of_scope',
  'unsupported_language',
  'injection_suspected',
  'abusive',
  'user_requested',
  'not_helpful',
  'max_turns',
  'quota_exceeded',
  'budget_exceeded',
  'model_refusal',
  'guardrail_failed',
  'error',
]);
export const messageVisibility = pgEnum('message_visibility', ['public', 'internal']);
export const feedbackValue = pgEnum('feedback_value', ['helpful', 'not_helpful']);
export const botDecision = pgEnum('bot_decision', ['answered', 'escalated', 'skipped']);
export const botMode = pgEnum('bot_mode', ['off', 'live']);
export const kbSourceStatus = pgEnum('kb_source_status', ['ingesting', 'active', 'retired']);
export const kbArticleStatus = pgEnum('kb_article_status', ['draft', 'approved', 'archived']);

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

// ------------------------------------------------------------------ 001

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    firebaseUid: text().unique(),
    email: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    phone: text(),
    about: text(),
    avatarUrl: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    index('users_created_at_idx').on(t.createdAt),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: text().notNull(),
    status: ticketStatus().notNull().default('open'),
    // 002
    botState: botState().notNull().default('idle'),
    botTurns: integer().notNull().default(0),
    escalationReason: escalationReason(),
    escalatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('tickets_user_updated_idx').on(t.userId, t.updatedAt.desc()),
    index('tickets_status_updated_idx').on(t.status, t.updatedAt.desc()),
    index('tickets_status_escalated_idx').on(t.status, t.escalatedAt),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** NULL only for messages written by the AI assistant. */
    authorId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    authorRole: authorRole().notNull(),
    body: text().notNull(),
    // 002
    visibility: messageVisibility().notNull().default('public'),
    personaName: text(),
    citations: jsonb().$type<{ kind: 'manual' | 'article'; title: string }[]>(),
    notice: text(),
    botRunId: uuid(),
    feedback: feedbackValue(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_messages_ticket_created_idx').on(t.ticketId, t.createdAt)],
);

// ------------------------------------------------------------------ 002: assistant

export const botSettings = pgTable('bot_settings', {
  id: smallint().primaryKey().default(1),
  mode: botMode().notNull().default('off'),
  personaName: text().notNull().default('Alex Carter'),
  minRelevance: numeric({ mode: 'number' }).notNull().default(0.55),
  maxTurnsPerTicket: integer().notNull().default(3),
  maxRunsPerUserPerDay: integer().notNull().default(20),
  monthlyBudgetUsd: numeric({ mode: 'number' }).notNull().default(18),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const botRuns = pgTable(
  'bot_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    messageId: uuid().notNull(),
    userId: uuid().notNull(),
    decision: botDecision().notNull(),
    escalationReason: escalationReason(),
    triage: jsonb(),
    /** ids, titles and scores only — never source text (security T11). */
    retrieved: jsonb().$type<{ kind: string; id: string; title: string; score: number }[]>(),
    guardrails: jsonb().$type<Record<string, string>>(),
    modelAnswer: text(),
    modelTriage: text(),
    promptVersion: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    costUsd: numeric({ mode: 'number', precision: 10, scale: 6 }).notNull().default(0),
    latencyMs: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bot_runs_message_uq').on(t.messageId),
    index('bot_runs_user_created_idx').on(t.userId, t.createdAt),
    index('bot_runs_created_idx').on(t.createdAt),
  ],
);

export const ticketSummaries = pgTable(
  'ticket_summaries',
  {
    ticketId: uuid()
      .primaryKey()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    summary: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_summaries_user_idx').on(t.userId, t.updatedAt.desc())],
);

// ------------------------------------------------------------------ 002: knowledge base

export const kbSources = pgTable(
  'kb_sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    edition: text().notNull(),
    language: text().notNull().default('en'),
    originUrl: text(),
    contentHash: text().notNull(),
    status: kbSourceStatus().notNull().default('ingesting'),
    licenceRef: text().notNull(),
    isDemo: boolean().notNull().default(false),
    ingestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('kb_sources_one_active_uq')
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const kbSections = pgTable(
  'kb_sections',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => kbSources.id, { onDelete: 'cascade' }),
    parentId: uuid(),
    level: smallint().notNull(),
    ordinal: integer().notNull(),
    externalKey: text().notNull(),
    title: text().notNull(),
    path: text().notNull(),
    url: text(),
    warnings: jsonb().$type<{ kind: 'warning' | 'note'; text: string }[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex('kb_sections_source_key_uq').on(t.sourceId, t.externalKey),
    index('kb_sections_parent_idx').on(t.parentId),
  ],
);

export const kbLinks = pgTable(
  'kb_links',
  {
    fromSectionId: uuid()
      .notNull()
      .references(() => kbSections.id, { onDelete: 'cascade' }),
    toSectionId: uuid()
      .notNull()
      .references(() => kbSections.id, { onDelete: 'cascade' }),
    anchorText: text().notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.fromSectionId, t.toSectionId] })],
);

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid().primaryKey().defaultRandom(),
    sectionId: uuid()
      .notNull()
      .references(() => kbSections.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull(),
    text: text().notNull(),
    tokenCount: integer().notNull(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector().generatedAlwaysAs(sql`to_tsvector('english', "text")`),
    contentHash: text().notNull(),
  },
  (t) => [
    index('kb_chunks_section_idx').on(t.sectionId),
    index('kb_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('kb_chunks_tsv_idx').using('gin', t.tsv),
  ],
);

export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid().primaryKey().defaultRandom(),
    question: text().notNull(),
    answer: text().notNull(),
    sourceTicketId: uuid().references(() => tickets.id, { onDelete: 'set null' }),
    status: kbArticleStatus().notNull().default('draft'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector().generatedAlwaysAs(sql`to_tsvector('english', "question" || ' ' || "answer")`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('kb_articles_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('kb_articles_tsv_idx').using('gin', t.tsv),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type MessageRow = typeof ticketMessages.$inferSelect;
export type BotSettingsRow = typeof botSettings.$inferSelect;
