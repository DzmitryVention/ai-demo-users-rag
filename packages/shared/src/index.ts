/**
 * Shared API contract: the single source of truth for request/response shapes
 * (specs/constitution.md §4). Consumed by apps/api (validation + OpenAPI) and
 * apps/web (types + client-side form validation).
 */
import { z } from 'zod';

// ---------------------------------------------------------------- primitives

export const RoleSchema = z.enum(['user', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const TicketStatusSchema = z.enum(['open', 'answered', 'pending_human', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/** Who wrote a ticket message. `bot` = the AI assistant persona (feature 002). */
export const AuthorRoleSchema = z.enum(['user', 'admin', 'bot']);
export type AuthorRole = z.infer<typeof AuthorRoleSchema>;

export const BotStateSchema = z.enum(['idle', 'queued', 'running', 'disabled']);
export type BotState = z.infer<typeof BotStateSchema>;

export const EscalationReasonSchema = z.enum([
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
export type EscalationReason = z.infer<typeof EscalationReasonSchema>;

export const IdParamsSchema = z.object({ id: z.uuid() });
export const MessageParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });

const isoDate = z.iso.datetime({ offset: true });

/** Trims and turns empty strings into null for optional free-text fields. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// ---------------------------------------------------------------- errors

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------- config

export const PublicConfigSchema = z.object({
  firebase: z.object({
    apiKey: z.string(),
    authDomain: z.string(),
    projectId: z.string(),
    appId: z.string(),
  }),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

// ---------------------------------------------------------------- users

export const PHONE_REGEX = /^\+?[0-9 ()\-.]{6,32}$/;

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  about: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type User = z.infer<typeof UserSchema>;

export const MeSchema = UserSchema.extend({ role: RoleSchema });
export type Me = z.infer<typeof MeSchema>;

export const UpdateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'Name is required').max(100),
  lastName: z.string().trim().min(1, 'Surname is required').max(100),
  phone: optionalText(32).refine((v) => v === null || PHONE_REGEX.test(v), {
    message: 'Enter a valid phone number',
  }),
  about: optionalText(2000),
});
export type UpdateProfileInput = z.input<typeof UpdateProfileSchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['createdAt', 'lastName', 'email']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListUsersQuery = z.input<typeof ListUsersQuerySchema>;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const UserListItemSchema = UserSchema.extend({
  ticketCount: z.number().int(),
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

export const UserListResponseSchema = paginated(UserListItemSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// ---------------------------------------------------------------- tickets

export const TicketAuthorSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  avatarUrl: z.string().nullable(),
});
export type TicketAuthor = z.infer<typeof TicketAuthorSchema>;

export const CitationSchema = z.object({
  kind: z.enum(['manual', 'article']),
  title: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const FeedbackValueSchema = z.enum(['helpful', 'not_helpful']);
export type FeedbackValue = z.infer<typeof FeedbackValueSchema>;

export const TicketMessageSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  authorRole: AuthorRoleSchema,
  /** null for messages written by the AI assistant. */
  author: TicketAuthorSchema.nullable(),
  /** Display name of the AI assistant persona (bot messages only). */
  personaName: z.string().nullable(),
  /** `internal` messages (assistant drafts) are only ever returned to admins. */
  visibility: z.enum(['public', 'internal']),
  citations: z.array(CitationSchema),
  /** Shown under assistant answers built on the demo knowledge base. */
  notice: z.string().nullable(),
  feedback: FeedbackValueSchema.nullable(),
  createdAt: isoDate,
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export const TicketSummarySchema = z.object({
  id: z.uuid(),
  subject: z.string(),
  status: TicketStatusSchema,
  messageCount: z.number().int(),
  lastMessagePreview: z.string().nullable(),
  requester: TicketAuthorSchema,
  botState: BotStateSchema,
  escalationReason: EscalationReasonSchema.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type TicketSummary = z.infer<typeof TicketSummarySchema>;

export const TicketDetailSchema = TicketSummarySchema.extend({
  messages: z.array(TicketMessageSchema),
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

export const TicketListResponseSchema = paginated(TicketSummarySchema);
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;

export const ListTicketsQuerySchema = PaginationQuerySchema.extend({
  status: TicketStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListTicketsQuery = z.input<typeof ListTicketsQuerySchema>;

export const MessageBodySchema = z.string().trim().min(1, 'Message is required').max(5000);

export const CreateTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Subject is too short').max(200),
  body: MessageBodySchema,
});
export type CreateTicketInput = z.input<typeof CreateTicketSchema>;

export const CreateMessageSchema = z.object({ body: MessageBodySchema });
export type CreateMessageInput = z.input<typeof CreateMessageSchema>;

export const UpdateTicketStatusSchema = z.object({ status: TicketStatusSchema });
export type UpdateTicketStatusInput = z.input<typeof UpdateTicketStatusSchema>;

export const FeedbackSchema = z.object({ value: FeedbackValueSchema });
export type FeedbackInput = z.input<typeof FeedbackSchema>;

export const ToggleBotSchema = z.object({ enabled: z.boolean() });

// ---------------------------------------------------------------- AI assistant (feature 002)

export const BotModeSchema = z.enum(['off', 'live']);
export type BotMode = z.infer<typeof BotModeSchema>;

export const BotSettingsSchema = z.object({
  mode: BotModeSchema,
  personaName: z.string().trim().min(2).max(60),
  minRelevance: z.number().min(0).max(1),
  maxTurnsPerTicket: z.number().int().min(1).max(10),
  maxRunsPerUserPerDay: z.number().int().min(1).max(500),
  monthlyBudgetUsd: z.number().min(0).max(1000),
});
export type BotSettings = z.infer<typeof BotSettingsSchema>;

export const BotOverviewSchema = z.object({
  settings: BotSettingsSchema,
  monthSpendUsd: z.number(),
  pendingHuman: z.number().int(),
  runs30d: z.object({
    total: z.number().int(),
    answered: z.number().int(),
    escalated: z.number().int(),
    helpful: z.number().int(),
    notHelpful: z.number().int(),
  }),
  escalationReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  knowledgeBase: z
    .object({
      title: z.string(),
      edition: z.string(),
      sections: z.number().int(),
      chunks: z.number().int(),
      ingestedAt: isoDate,
    })
    .nullable(),
});
export type BotOverview = z.infer<typeof BotOverviewSchema>;

export const BotRunSchema = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  ticketSubject: z.string(),
  decision: z.enum(['answered', 'escalated', 'skipped']),
  escalationReason: EscalationReasonSchema.nullable(),
  sources: z.array(z.object({ kind: z.string(), title: z.string(), score: z.number() })),
  guardrails: z.record(z.string(), z.string()),
  modelAnswer: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int(),
  createdAt: isoDate,
});
export type BotRun = z.infer<typeof BotRunSchema>;
export const BotRunListResponseSchema = paginated(BotRunSchema);
export type BotRunListResponse = z.infer<typeof BotRunListResponseSchema>;

export const KbArticleStatusSchema = z.enum(['draft', 'approved', 'archived']);
export const KbArticleSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  answer: z.string(),
  status: KbArticleStatusSchema,
  sourceTicketId: z.uuid().nullable(),
  createdAt: isoDate,
  approvedAt: isoDate.nullable(),
});
export type KbArticle = z.infer<typeof KbArticleSchema>;
export const KbArticleListSchema = z.object({ items: z.array(KbArticleSchema) });

export const CreateKbArticleSchema = z.object({ ticketId: z.uuid() });
export const UpdateKbArticleSchema = z
  .object({
    question: z.string().trim().min(5).max(500).optional(),
    answer: z.string().trim().min(5).max(3000).optional(),
    status: KbArticleStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateKbArticleInput = z.input<typeof UpdateKbArticleSchema>;

export const AdminUserDetailSchema = UserSchema.extend({
  tickets: z.array(TicketSummarySchema),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const HealthSchema = z.object({ status: z.literal('ok'), db: z.enum(['up', 'down']) });

// ---------------------------------------------------------------- domain rules

/**
 * Ticket status after a new public message (001 data model + 002 plan § state machine):
 * admin or assistant reply → answered; user follow-up → open, unless the ticket is
 * waiting for a human, in which case it keeps waiting.
 */
export function nextStatusAfterMessage(
  authorRole: AuthorRole,
  current: TicketStatus = 'open',
): TicketStatus {
  if (authorRole !== 'user') return 'answered';
  return current === 'pending_human' ? 'pending_human' : 'open';
}

export function isAdminEmail(email: string | undefined | null, adminEmails: readonly string[]) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return adminEmails.some((e) => e.trim().toLowerCase() === normalized);
}
