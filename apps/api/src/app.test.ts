import { PGlite } from '@electric-sql/pglite';
import type { MeSchema, TicketDetail, UserListResponse } from '@app/shared';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { buildApp } from './app.ts';
import type { VerifiedIdentity } from './auth.ts';
import * as schema from './db/schema.ts';

// Same email as the seeded support agent, to exercise linking a pre-loaded user.
const ADMIN = 'support@example.com';

/** Test tokens are just keys into this map. */
const identities: Record<string, VerifiedIdentity> = {
  admin: {
    uid: 'uid-admin',
    email: ADMIN,
    emailVerified: true,
    name: 'Support Agent',
    picture: null,
  },
  alice: {
    uid: 'uid-alice',
    email: 'alice@test.dev',
    emailVerified: true,
    name: 'Alice Ann Smith',
    picture: null,
  },
  bob: { uid: 'uid-bob', email: 'bob@test.dev', emailVerified: true, name: 'Bob', picture: null },
  unverified: { uid: 'uid-x', email: 'x@test.dev', emailVerified: false, name: 'X', picture: null },
};

let app: Awaited<ReturnType<typeof buildApp>>;
let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, {
    migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle'),
  });

  app = await buildApp({
    env: {
      NODE_ENV: 'test',
      ADMIN_EMAILS: [ADMIN],
      FIREBASE_PROJECT_ID: 'demo-test',
      FIREBASE_API_KEY: 'k',
      FIREBASE_AUTH_DOMAIN: '',
      FIREBASE_APP_ID: 'a',
      WEB_DIST_DIR: undefined,
    },
    db: db,
    pingDb: async () => true,
    verifier: {
      verify: async (token) => {
        const identity = identities[token];
        if (!identity) throw new Error('bad token');
        return identity;
      },
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await client.close();
});

const as = (who: string) => ({ authorization: `Bearer ${who}` });

describe('public endpoints', () => {
  it('GET /api/health', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/config exposes only public Firebase config', async () => {
    const res = await app.inject({ url: '/api/config' });
    expect(res.json()).toEqual({
      firebase: {
        apiKey: 'k',
        authDomain: 'demo-test.firebaseapp.com',
        projectId: 'demo-test',
        appId: 'a',
      },
    });
  });

  it('unknown API routes return JSON 404', async () => {
    const res = await app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('authentication (US-1)', () => {
  it('rejects missing and invalid tokens', async () => {
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me', headers: as('forged') })).statusCode).toBe(401);
  });

  it('rejects unverified emails (AC-1.3)', async () => {
    const res = await app.inject({ url: '/api/me', headers: as('unverified') });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('creates a user on first sign-in with names from Google (AC-1.2, AC-2.2)', async () => {
    const res = await app.inject({ url: '/api/me', headers: as('alice') });
    const me = res.json<z.infer<typeof MeSchema>>();
    expect(res.statusCode).toBe(200);
    expect(me).toMatchObject({
      email: 'alice@test.dev',
      firstName: 'Alice Ann',
      lastName: 'Smith',
      role: 'user',
    });
    const again = await app.inject({ url: '/api/me', headers: as('alice') });
    expect(again.json().id).toBe(me.id);
  });

  it('links the seeded admin record by email and grants admin role (AC-1.4)', async () => {
    const res = await app.inject({ url: '/api/me', headers: as('admin') });
    expect(res.json()).toMatchObject({
      email: ADMIN,
      role: 'admin',
      about: 'Demo support agent (seed data).',
    });
  });
});

describe('profile (US-2)', () => {
  it('updates own profile and validates input (AC-2.3)', async () => {
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as('alice'),
      payload: { firstName: 'Alice', lastName: 'Smith', phone: '+1 555 123 4567', about: 'Hi' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      firstName: 'Alice',
      phone: '+1 555 123 4567',
      email: 'alice@test.dev',
    });

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as('alice'),
      payload: { firstName: '', lastName: 'Smith', phone: 'nope', about: null },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('help desk (US-4, US-5)', () => {
  let ticket: TicketDetail;

  it('user creates a ticket (AC-4.1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: as('alice'),
      payload: { subject: 'Cannot log in', body: 'Popup closes immediately.' },
    });
    expect(res.statusCode).toBe(201);
    ticket = res.json();
    expect(ticket).toMatchObject({ status: 'open', messageCount: 1, subject: 'Cannot log in' });
    expect(ticket.messages[0]).toMatchObject({
      authorRole: 'user',
      body: 'Popup closes immediately.',
    });
  });

  it('users see only their own tickets (AC-4.2)', async () => {
    const alice = await app.inject({ url: '/api/tickets', headers: as('alice') });
    expect(alice.json().items.map((t: TicketDetail) => t.id)).toEqual([ticket.id]);

    const bob = await app.inject({ url: '/api/tickets', headers: as('bob') });
    expect(bob.json().total).toBe(0);
    const peek = await app.inject({ url: `/api/tickets/${ticket.id}`, headers: as('bob') });
    expect(peek.statusCode).toBe(404);
    const write = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: as('bob'),
      payload: { body: 'hijack' },
    });
    expect(write.statusCode).toBe(404);
  });

  it('admin replies → answered; user follow-up → open (AC-5.2, AC-5.3)', async () => {
    const reply = await app.inject({
      method: 'POST',
      url: `/api/admin/tickets/${ticket.id}/messages`,
      headers: as('admin'),
      payload: { body: 'Please try another browser.' },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ status: 'answered', messageCount: 2 });

    const follow = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: as('alice'),
      payload: { body: 'Still broken' },
    });
    const detail = follow.json<TicketDetail>();
    expect(detail.status).toBe('open');
    expect(detail.messages.map((m) => m.authorRole)).toEqual(['user', 'admin', 'user']);
  });

  it('admin filters tickets by status and can close (AC-5.1, AC-5.4)', async () => {
    const open = await app.inject({
      url: '/api/admin/tickets?status=open&pageSize=100',
      headers: as('admin'),
    });
    expect(open.json().items.every((t: TicketDetail) => t.status === 'open')).toBe(true);
    expect(open.json().items.some((t: TicketDetail) => t.id === ticket.id)).toBe(true);

    const closed = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${ticket.id}`,
      headers: as('admin'),
      payload: { status: 'closed' },
    });
    expect(closed.json().status).toBe('closed');
  });

  it('user can close own ticket (AC-4.4)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/close`,
      headers: as('alice'),
    });
    expect(res.json().status).toBe('closed');
  });
});

describe('admin users pool (US-3, US-6)', () => {
  it('non-admins get 403 on admin APIs (AC-3.4, AC-4.5)', async () => {
    for (const url of ['/api/admin/users', '/api/admin/tickets']) {
      const res = await app.inject({ url, headers: as('alice') });
      expect(res.statusCode).toBe(403);
    }
  });

  it('lists the seeded pool with pagination (AC-3.1, AC-6.1)', async () => {
    const res = await app.inject({ url: '/api/admin/users?pageSize=10', headers: as('admin') });
    const body = res.json<UserListResponse>();
    expect(res.statusCode).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(100);
    expect(body.items).toHaveLength(10);
    expect(body.items[0]).toHaveProperty('ticketCount');
  });

  it('searches by email, name or full name (AC-3.2)', async () => {
    const byEmail = await app.inject({
      url: '/api/admin/users?q=alice@test',
      headers: as('admin'),
    });
    expect(byEmail.json().items.map((u: { email: string }) => u.email)).toEqual(['alice@test.dev']);
    const byFull = await app.inject({
      url: '/api/admin/users?q=alice%20smith',
      headers: as('admin'),
    });
    expect(byFull.json().total).toBe(1);
    const wildcard = await app.inject({ url: '/api/admin/users?q=%25', headers: as('admin') });
    expect(wildcard.json().total).toBe(0);
  });

  it('shows user details with their tickets (AC-3.3)', async () => {
    const list = await app.inject({ url: '/api/admin/users?q=alice@test', headers: as('admin') });
    const id = list.json().items[0].id;
    const res = await app.inject({ url: `/api/admin/users/${id}`, headers: as('admin') });
    expect(res.json()).toMatchObject({ email: 'alice@test.dev', phone: '+1 555 123 4567' });
    expect(res.json().tickets).toHaveLength(1);
  });

  it('validates path params', async () => {
    const res = await app.inject({ url: '/api/admin/users/not-a-uuid', headers: as('admin') });
    expect(res.statusCode).toBe(400);
  });
});
