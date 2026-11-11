/**
 * Shared API contract: the single source of truth for request/response shapes
 * (specs/constitution.md §4). Consumed by apps/api (validation + OpenAPI) and
 * apps/web (types + client-side form validation).
 */
import { z } from 'zod';

// ---------------------------------------------------------------- primitives

export const RoleSchema = z.enum(['user', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const TicketStatusSchema = z.enum(['open', 'answered', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const IdParamsSchema = z.object({ id: z.uuid() });

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

export const TicketMessageSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  authorRole: RoleSchema,
  author: TicketAuthorSchema,
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

export const AdminUserDetailSchema = UserSchema.extend({
  tickets: z.array(TicketSummarySchema),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const HealthSchema = z.object({ status: z.literal('ok'), db: z.enum(['up', 'down']) });

// ---------------------------------------------------------------- domain rules

/** Ticket status state machine (specs/001-users-helpdesk/data-model.md). */
export function nextStatusAfterMessage(authorRole: Role): TicketStatus {
  return authorRole === 'admin' ? 'answered' : 'open';
}

export function isAdminEmail(email: string | undefined | null, adminEmails: readonly string[]) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return adminEmails.some((e) => e.trim().toLowerCase() === normalized);
}
