import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const ticketStatus = pgEnum('ticket_status', ['open', 'answered', 'closed']);
export const authorRole = pgEnum('author_role', ['user', 'admin']);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

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
    ...timestamps,
  },
  (t) => [
    index('tickets_user_updated_idx').on(t.userId, t.updatedAt.desc()),
    index('tickets_status_updated_idx').on(t.status, t.updatedAt.desc()),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authorRole: authorRole().notNull(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_messages_ticket_created_idx').on(t.ticketId, t.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
