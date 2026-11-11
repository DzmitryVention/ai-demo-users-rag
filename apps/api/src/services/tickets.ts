import {
  nextStatusAfterMessage,
  type Role,
  type TicketAuthor,
  type TicketDetail,
  type TicketListResponse,
  type TicketStatus,
  type TicketSummary,
} from '@app/shared';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { ticketMessages, tickets, users, type TicketRow, type UserRow } from '../db/schema.ts';
import { notFound } from '../errors.ts';

export interface ListTicketsOptions {
  page: number;
  pageSize: number;
  status?: TicketStatus | undefined;
  q?: string | undefined;
  /** Restrict to one requester (always set for non-admin callers). */
  userId?: string | undefined;
}

/** `ownerId` restricts access to the requester; omitted only for admins. */
export interface AccessScope {
  ownerId?: string | undefined;
}

const toAuthor = (u: Pick<UserRow, 'id' | 'firstName' | 'lastName' | 'email' | 'avatarUrl'>) =>
  ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    avatarUrl: u.avatarUrl,
  }) satisfies TicketAuthor;

const messageCountSql = sql<number>`(select count(*) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id})::int`;
const lastPreviewSql = sql<
  string | null
>`(select left(${ticketMessages.body}, 160) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id} order by ${ticketMessages.createdAt} desc limit 1)`;

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
    createdAt: row.ticket.createdAt.toISOString(),
    updatedAt: row.ticket.updatedAt.toISOString(),
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

  const [rows, [countRow]] = await Promise.all([
    db
      .select(summarySelection)
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.userId))
      .where(where)
      .orderBy(desc(tickets.updatedAt), asc(tickets.id))
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
    .innerJoin(users, eq(users.id, ticketMessages.authorId))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));

  return {
    ...toSummary(row),
    messages: messages.map(({ message, author }) => ({
      id: message.id,
      body: message.body,
      authorRole: message.authorRole,
      author: toAuthor(author),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function createTicket(
  db: Database,
  userId: string,
  input: { subject: string; body: string },
): Promise<TicketDetail> {
  const ticketId = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({ userId, subject: input.subject, status: 'open' })
      .returning({ id: tickets.id });
    await tx
      .insert(ticketMessages)
      .values({ ticketId: ticket!.id, authorId: userId, authorRole: 'user', body: input.body });
    return ticket!.id;
  });
  return getTicket(db, ticketId);
}

export async function addMessage(
  db: Database,
  ticketId: string,
  author: { id: string; role: Role },
  body: string,
  scope: AccessScope = {},
): Promise<TicketDetail> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tickets)
      .set({ status: nextStatusAfterMessage(author.role), updatedAt: new Date() })
      .where(
        and(
          eq(tickets.id, ticketId),
          scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined,
        ),
      )
      .returning({ id: tickets.id });
    if (!updated) throw notFound('Ticket');
    await tx
      .insert(ticketMessages)
      .values({ ticketId, authorId: author.id, authorRole: author.role, body });
  });
  return getTicket(db, ticketId, scope);
}

export async function setTicketStatus(
  db: Database,
  ticketId: string,
  status: TicketStatus,
  scope: AccessScope = {},
): Promise<TicketDetail> {
  const [updated] = await db
    .update(tickets)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(tickets.id, ticketId), scope.ownerId ? eq(tickets.userId, scope.ownerId) : undefined),
    )
    .returning({ id: tickets.id });
  if (!updated) throw notFound('Ticket');
  return getTicket(db, ticketId, scope);
}
