import {
  nextStatusAfterMessage,
  type EscalationReason,
  type FeedbackValue,
  type Role,
  type TicketAuthor,
  type TicketDetail,
  type TicketListResponse,
  type TicketMessage,
  type TicketStatus,
  type TicketSummary,
} from '@app/shared';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  ticketMessages,
  tickets,
  users,
  type MessageRow,
  type TicketRow,
  type UserRow,
} from '../db/schema.ts';
import { AppError, notFound } from '../errors.ts';

export interface ListTicketsOptions {
  page: number;
  pageSize: number;
  status?: TicketStatus | undefined;
  q?: string | undefined;
  /** Restrict to one requester (always set for non-admin callers). */
  userId?: string | undefined;
}

/**
 * `ownerId` restricts access to the requester (omitted only for admins).
 * `includeInternal` returns admin-only messages (assistant drafts) — admins only.
 */
export interface AccessScope {
  ownerId?: string | undefined;
  includeInternal?: boolean;
}

/** Result of a user-side write: the ticket plus the message to hand to the assistant. */
export interface UserWriteResult {
  ticket: TicketDetail;
  messageId: string;
}

const toAuthor = (u: Pick<UserRow, 'id' | 'firstName' | 'lastName' | 'email' | 'avatarUrl'>) =>
  ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    avatarUrl: u.avatarUrl,
  }) satisfies TicketAuthor;

// Counts and previews only consider public messages, for users and admins alike.
const messageCountSql = sql<number>`(select count(*) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id} and ${ticketMessages.visibility} = 'public')::int`;
const lastPreviewSql = sql<
  string | null
>`(select left(${ticketMessages.body}, 160) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id} and ${ticketMessages.visibility} = 'public' order by ${ticketMessages.createdAt} desc limit 1)`;

function toSummary(row: {
  ticket: TicketRow;
  requester: UserRow;
  messageCount: number;
  lastMessagePreview: string | null;
}): TicketSummary {
  return {
    id: row.ticket.id,
    subject: row.ticket.subject,
    status: row.ticket.status,
    messageCount: row.messageCount,
    lastMessagePreview: row.lastMessagePreview,
    requester: toAuthor(row.requester),
    botState: row.ticket.botState,
    escalationReason: row.ticket.escalationReason,
    createdAt: row.ticket.createdAt.toISOString(),
    updatedAt: row.ticket.updatedAt.toISOString(),
  };
}

function toMessage(message: MessageRow, author: UserRow | null): TicketMessage {
  return {
    id: message.id,
    body: message.body,
    authorRole: message.authorRole,
    author: author ? toAuthor(author) : null,
    personaName: message.authorRole === 'bot' ? (message.personaName ?? 'AI assistant') : null,
    visibility: message.visibility,
    citations: message.citations ?? [],
    notice: message.notice,
    feedback: message.feedback,
    createdAt: message.createdAt.toISOString(),
  };
}

const summarySelection = {
  ticket: tickets,
  requester: users,
  messageCount: messageCountSql,
  lastMessagePreview: lastPreviewSql,
};

export async function listTickets(
  db: Database,
  opts: ListTicketsOptions,
): Promise<TicketListResponse> {
  const filters: SQL[] = [];
  if (opts.userId) filters.push(eq(tickets.userId, opts.userId));
  if (opts.status) filters.push(eq(tickets.status, opts.status));
  if (opts.q) {
    const pattern = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(ilike(tickets.subject, pattern));
  }
  const where = filters.length ? and(...filters) : undefined;
  // The "Needs human" queue is worked oldest first (spec AC-3.1).
  const order =
    opts.status === 'pending_human'
      ? [asc(tickets.escalatedAt), asc(tickets.id)]
      : [desc(tickets.updatedAt), asc(tickets.id)];

  const [rows, [countRow]] = await Promise.all([
    db
      .select(summarySelection)
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.userId))
      .where(where)
      .orderBy(...order)
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where),
  ]);

  return {
    items: rows.map(toSummary),
    total: countRow?.total ?? 0,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

export async function getTicket(
  db: Database,
  ticketId: string,
  scope: AccessScope = {},
): Promise<TicketDetail> {
  const [row] = await db
    .select(summarySelection)
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.userId))
    .where(
      and(eq(tickets.id, ticketId), scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined),
    );
  // Same 404 for "missing" and "not yours" so ticket ids can't be probed.
  if (!row) throw notFound('Ticket');

  const messages = await db
    .select({ message: ticketMessages, author: users })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorId))
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        scope.includeInternal ? undefined : eq(ticketMessages.visibility, 'public'),
      ),
    )
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));

  return {
    ...toSummary(row),
    messages: messages.map(({ message, author }) => toMessage(message, author)),
  };
}

export async function createTicket(
  db: Database,
  userId: string,
  input: { subject: string; body: string },
): Promise<UserWriteResult> {
  const { ticketId, messageId } = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({ userId, subject: input.subject, status: 'open' })
      .returning({ id: tickets.id });
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId: ticket!.id, authorId: userId, authorRole: 'user', body: input.body })
      .returning({ id: ticketMessages.id });
    return { ticketId: ticket!.id, messageId: message!.id };
  });
  return { ticket: await getTicket(db, ticketId), messageId };
}

export async function addMessage(
  db: Database,
  ticketId: string,
  author: { id: string; role: Role },
  body: string,
  scope: AccessScope = {},
): Promise<UserWriteResult> {
  const messageId = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: tickets.status })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, ticketId),
          scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined,
        ),
      )
      .for('update');
    if (!current) throw notFound('Ticket');

    await tx
      .update(tickets)
      .set({
        status: nextStatusAfterMessage(author.role, current.status),
        // Once a person from support has replied, the assistant stays out (AC-3.4).
        ...(author.role === 'admin' ? { botState: 'disabled' as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId));
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId, authorId: author.id, authorRole: author.role, body })
      .returning({ id: ticketMessages.id });
    return message!.id;
  });
  return { ticket: await getTicket(db, ticketId, scope), messageId };
}

export async function setTicketStatus(
  db: Database,
  ticketId: string,
  status: TicketStatus,
  scope: AccessScope = {},
): Promise<TicketDetail> {
  const [updated] = await db
    .update(tickets)
    .set({
      status,
      ...(status === 'pending_human'
        ? { escalatedAt: new Date(), botState: 'disabled' as const }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(tickets.id, ticketId), scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined),
    )
    .returning({ id: tickets.id });
  if (!updated) throw notFound('Ticket');
  return getTicket(db, ticketId, scope);
}

/** Hands a ticket to a human (user "Talk to a person", "not helpful"; spec US-2). */
export async function escalateTicket(
  db: Database,
  ticketId: string,
  reason: EscalationReason,
  scope: AccessScope = {},
): Promise<TicketDetail> {
  const [updated] = await db
    .update(tickets)
    .set({
      status: 'pending_human',
      botState: 'disabled',
      escalationReason: reason,
      escalatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(tickets.id, ticketId), scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined),
    )
    .returning({ id: tickets.id });
  if (!updated) throw notFound('Ticket');
  return getTicket(db, ticketId, scope);
}

/** Requester rates an assistant reply; "not helpful" escalates (AC-2.4). */
export async function setFeedback(
  db: Database,
  ticketId: string,
  messageId: string,
  value: FeedbackValue,
  ownerId: string,
): Promise<TicketDetail> {
  const [msg] = await db
    .select({ id: ticketMessages.id, role: ticketMessages.authorRole })
    .from(ticketMessages)
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .where(
      and(
        eq(ticketMessages.id, messageId),
        eq(ticketMessages.ticketId, ticketId),
        eq(ticketMessages.visibility, 'public'),
        eq(tickets.userId, ownerId),
      ),
    );
  if (!msg) throw notFound('Message');
  if (msg.role !== 'bot') {
    throw new AppError(400, 'NOT_A_BOT_MESSAGE', 'Feedback is only possible on assistant replies');
  }
  await db.update(ticketMessages).set({ feedback: value }).where(eq(ticketMessages.id, messageId));
  if (value === 'not_helpful') return escalateTicket(db, ticketId, 'not_helpful', { ownerId });
  return getTicket(db, ticketId, { ownerId });
}

/** Admin takes over (disable) or hands back to the assistant (enable) — AC-3.4/3.5. */
export async function setBotEnabled(
  db: Database,
  ticketId: string,
  enabled: boolean,
): Promise<TicketDetail> {
  const [updated] = await db
    .update(tickets)
    .set({
      botState: enabled ? 'idle' : 'disabled',
      botTurns: enabled ? 0 : sql`${tickets.botTurns}`,
    })
    .where(eq(tickets.id, ticketId))
    .returning({ id: tickets.id });
  if (!updated) throw notFound('Ticket');
  return getTicket(db, ticketId, { includeInternal: true });
}

/**
 * Marks the ticket as queued for the assistant when it may answer. Returns true when
 * the caller should enqueue a task. (Mode and quotas are re-checked by the worker.)
 */
export async function markQueuedIfEligible(db: Database, ticketId: string): Promise<boolean> {
  const [row] = await db
    .update(tickets)
    .set({ botState: 'queued' })
    .where(
      and(
        eq(tickets.id, ticketId),
        sql`${tickets.botState} <> 'disabled'`,
        sql`${tickets.status} not in ('pending_human', 'closed')`,
      ),
    )
    .returning({ id: tickets.id });
  return Boolean(row);
}
