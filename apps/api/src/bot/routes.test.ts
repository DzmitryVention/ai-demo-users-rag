import type { BotOverview, TicketDetail } from '@app/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, fakeEmbedder, fakeLlm } from '../../test/helpers.ts';
import { buildApp } from '../app.ts';
import type { VerifiedIdentity } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { botRuns, botSettings } from '../db/schema.ts';
import { ingestManual } from '../kb/ingest.ts';
import { DEMO_NOTICE } from './pipeline.ts';
import { createInlineQueue } from './queue.ts';
import { handleTask, type BotRuntime } from './runtime.ts';

const ADMIN = 'admin@example.com';
const identities: Record<string, VerifiedIdentity> = {
  admin: { uid: 'u-admin', email: ADMIN, emailVerified: true, name: 'Ada Admin', picture: null },
  carol: {
    uid: 'u-carol',
    email: 'carol@test.dev',
    emailVerified: true,
    name: 'Carol C',
    picture: null,
  },
};
const as = (who: string) => ({ authorization: `Bearer ${who}` });

let db: Database;
let close: () => Promise<void>;
let app: Awaited<ReturnType<typeof buildApp>>;
let queue: ReturnType<typeof createInlineQueue>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const embedder = fakeEmbedder();
  await ingestManual(db, embedder);
  const { llm } = fakeLlm();

  const bot: BotRuntime = {
    ai: { ...llm, ...embedder },
    queue: { enqueue: async () => undefined },
    taskVerifier: {
      verify: async (auth) => {
        if (auth !== 'Bearer tasks-token') throw new Error('bad token');
      },
    },
    demoNotice: DEMO_NOTICE,
  };
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
    db,
    pingDb: async () => true,
    verifier: {
      verify: async (token) => {
        const identity = identities[token];
        if (!identity) throw new Error('bad token');
        return identity;
      },
    },
    bot,
  });
  queue = createInlineQueue((task) => handleTask(bot, db, app.log, task));
  bot.queue = queue;
  await app.ready();
  await db.update(botSettings).set({ minRelevance: 0.05 }).where(eq(botSettings.id, 1));
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('assistant end-to-end through the API', () => {
  it('is off by default; admin turns it on', async () => {
    const overview = await app.inject({ url: '/api/admin/bot/overview', headers: as('admin') });
    expect(overview.json<BotOverview>().settings.mode).toBe('off');
    expect(overview.json<BotOverview>().knowledgeBase?.chunks).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/bot/settings',
      headers: as('admin'),
      payload: { ...overview.json<BotOverview>().settings, mode: 'live' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('live');
  });

  it('non-admins cannot change assistant settings', async () => {
    const res = await app.inject({ url: '/api/admin/bot/overview', headers: as('carol') });
    expect(res.statusCode).toBe(403);
  });

  it('a new request is answered by the assistant', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: as('carol'),
      payload: { subject: 'Engine oil', body: 'How do I check the engine oil level?' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<TicketDetail>().botState).toBe('queued');
    await queue.idle();

    const detail = await app.inject({
      url: `/api/tickets/${created.json().id}`,
      headers: as('carol'),
    });
    const ticket = detail.json<TicketDetail>();
    expect(ticket.status).toBe('answered');
    const reply = ticket.messages.find((m) => m.authorRole === 'bot')!;
    expect(reply).toMatchObject({ personaName: 'Alex Carter', author: null, notice: DEMO_NOTICE });

    // 👎 escalates to a human
    const fb = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages/${reply.id}/feedback`,
      headers: as('carol'),
      payload: { value: 'not_helpful' },
    });
    expect(fb.json<TicketDetail>()).toMatchObject({
      status: 'pending_human',
      escalationReason: 'not_helpful',
      botState: 'disabled',
    });

    // follow-ups stay with humans; the assistant does not answer again
    await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: as('carol'),
      payload: { body: 'Still unclear' },
    });
    await queue.idle();
    const after = await app.inject({ url: `/api/tickets/${ticket.id}`, headers: as('carol') });
    expect(after.json<TicketDetail>().status).toBe('pending_human');
    expect(after.json<TicketDetail>().messages.filter((m) => m.authorRole === 'bot')).toHaveLength(
      1,
    );

    // admin sees it in the "Needs human" queue and answers manually
    const inbox = await app.inject({
      url: '/api/admin/tickets?status=pending_human',
      headers: as('admin'),
    });
    expect(inbox.json().items.map((t: { id: string }) => t.id)).toContain(ticket.id);
    const answered = await app.inject({
      method: 'POST',
      url: `/api/admin/tickets/${ticket.id}/messages`,
      headers: as('admin'),
      payload: { body: 'Here is how to do it step by step.' },
    });
    expect(answered.json<TicketDetail>()).toMatchObject({
      status: 'answered',
      botState: 'disabled',
    });
  });

  it('"Talk to a person" escalates immediately', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: as('carol'),
      payload: { subject: 'Tyres', body: 'Question about tyre pressure' },
    });
    await queue.idle();
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${created.json().id}/escalate`,
      headers: as('carol'),
    });
    expect(res.json<TicketDetail>()).toMatchObject({
      status: 'pending_human',
      escalationReason: 'user_requested',
    });
  });

  it('feedback only applies to assistant messages', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: as('carol'),
      payload: { subject: 'Hello', body: 'Hello there' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const own = created.json<TicketDetail>().messages[0]!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${created.json().id}/messages/${own.id}/feedback`,
      headers: as('carol'),
      payload: { value: 'helpful' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('records an audit trail visible to admins', async () => {
    const res = await app.inject({ url: '/api/admin/bot/runs?pageSize=50', headers: as('admin') });
    expect(res.json().total).toBeGreaterThan(0);
    const runs = await db.select().from(botRuns);
    expect(runs.every((r) => !JSON.stringify(r.retrieved).includes('dipstick'))).toBe(true);
  });
});

describe('internal task endpoint', () => {
  it('rejects calls without a valid task token', async () => {
    const payload = { kind: 'summary', ticketId: '00000000-0000-4000-8000-000000000000' };
    const none = await app.inject({ method: 'POST', url: '/internal/bot/tasks', payload });
    expect(none.statusCode).toBe(401);
    const bad = await app.inject({
      method: 'POST',
      url: '/internal/bot/tasks',
      payload,
      headers: { authorization: 'Bearer user-token' },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/internal/bot/tasks',
      payload,
      headers: { authorization: 'Bearer tasks-token' },
    });
    expect(ok.statusCode).toBe(204);
  });
});

describe('knowledge articles', () => {
  it('drafts from a resolved ticket and approves with an embedding', async () => {
    const list = await app.inject({
      url: '/api/admin/tickets?status=answered',
      headers: as('admin'),
    });
    const ticketId = list.json().items[0].id as string;
    const draft = await app.inject({
      method: 'POST',
      url: '/api/admin/kb/articles',
      headers: as('admin'),
      payload: { ticketId },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().status).toBe('draft');
    const approved = await app.inject({
      method: 'PATCH',
      url: `/api/admin/kb/articles/${draft.json().id}`,
      headers: as('admin'),
      payload: { status: 'approved' },
    });
    expect(approved.json()).toMatchObject({ status: 'approved' });
    expect(approved.json().approvedAt).not.toBeNull();
  });
});
