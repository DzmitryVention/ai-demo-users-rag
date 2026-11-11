import type {
  AdminUserDetail,
  ListUsersQuerySchema,
  UpdateProfileSchema,
  User,
  UserListResponse,
} from '@app/shared';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { VerifiedIdentity } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { tickets, users, type UserRow } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { listTickets } from './tickets.ts';

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    about: row.about,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** "Ann Marie Lee" → ["Ann Marie", "Lee"]; falls back to the email local part. */
export function splitDisplayName(name: string | null, email: string): [string, string] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [email.split('@')[0] ?? email, ''];
  if (parts.length === 1) return [parts[0]!, ''];
  return [parts.slice(0, -1).join(' '), parts.at(-1)!];
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  ('code' in err ? err.code : (err as { cause?: { code?: string } }).cause?.code) === '23505';

/**
 * Finds the user for a verified identity, creating it on first sign-in.
 * Pre-loaded users (no firebase_uid yet) are linked by case-insensitive email.
 */
export async function upsertFromIdentity(db: Database, identity: VerifiedIdentity) {
  const [byUid] = await db.select().from(users).where(eq(users.firebaseUid, identity.uid));
  if (byUid) {
    if (identity.picture && byUid.avatarUrl !== identity.picture) {
      const [updated] = await db
        .update(users)
        .set({ avatarUrl: identity.picture })
        .where(eq(users.id, byUid.id))
        .returning();
      return updated ?? byUid;
    }
    return byUid;
  }

  const [linked] = await db
    .update(users)
    .set({
      firebaseUid: identity.uid,
      avatarUrl: identity.picture,
      updatedAt: new Date(),
    })
    .where(and(isNull(users.firebaseUid), sql`lower(${users.email}) = lower(${identity.email})`))
    .returning();
  if (linked) return linked;

  const [firstName, lastName] = splitDisplayName(identity.name, identity.email);
  try {
    const [created] = await db
      .insert(users)
      .values({
        firebaseUid: identity.uid,
        email: identity.email,
        firstName,
        lastName,
        avatarUrl: identity.picture,
      })
      .returning();
    return created!;
  } catch (err) {
    // Concurrent first requests from the same user: the other one won the race.
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db.select().from(users).where(eq(users.firebaseUid, identity.uid));
    if (!existing) throw err;
    return existing;
  }
}

export async function updateProfile(
  db: Database,
  userId: string,
  input: z.output<typeof UpdateProfileSchema>,
) {
  const [row] = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw notFound('User');
  return row;
}

const ticketCountSql = sql<number>`(select count(*) from ${tickets} where ${tickets.userId} = ${users.id})::int`;

export async function listUsers(
  db: Database,
  query: z.output<typeof ListUsersQuerySchema>,
): Promise<UserListResponse> {
  const { page, pageSize, q, sort, order } = query;

  let where: SQL | undefined;
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where = or(
      ilike(users.firstName, pattern),
      ilike(users.lastName, pattern),
      ilike(users.email, pattern),
      ilike(users.phone, pattern),
      sql`(${users.firstName} || ' ' || ${users.lastName}) ilike ${pattern}`,
    );
  }

  const sortColumn = { createdAt: users.createdAt, lastName: users.lastName, email: users.email }[
    sort
  ];
  const direction = order === 'asc' ? asc : desc;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({ user: users, ticketCount: ticketCountSql })
      .from(users)
      .where(where)
      .orderBy(direction(sortColumn), asc(users.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);

  return {
    items: rows.map((r) => ({ ...toUser(r.user), ticketCount: r.ticketCount })),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
}

export async function getUserDetail(db: Database, userId: string): Promise<AdminUserDetail> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) throw notFound('User');
  const userTickets = await listTickets(db, { page: 1, pageSize: 100, userId });
  return { ...toUser(row), tickets: userTickets.items };
}
