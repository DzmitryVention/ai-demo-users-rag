/**
 * Generates drizzle/0001_seed_fake_users.sql — ~100 fake users plus sample
 * help-desk conversations. Deterministic (fixed Faker seed and dates), so the
 * committed migration is reviewable and regenerating it yields the same file.
 *
 *   npm run db:generate-seed -w @app/api
 */
import { faker } from '@faker-js/faker';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 20261111;
const USER_COUNT = 100;
const TICKET_COUNT = 25;
/** Seeded support agent that authors the sample admin replies (not a real account). */
const ADMIN_EMAIL = 'support@example.com';
const FROM = new Date('2025-11-01T00:00:00Z');
const TO = new Date('2026-11-01T00:00:00Z');

faker.seed(SEED);
faker.setDefaultRefDate(TO);

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);
const ts = (d: Date) => `'${d.toISOString()}'`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Resolve the admin by email so the seed works even if the admin row already exists. */
const ADMIN_ID_SQL = `(SELECT "id" FROM "users" WHERE lower("email") = ${q(ADMIN_EMAIL)})`;

interface SeedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  about: string | null;
  createdAt: Date;
}

const usedEmails = new Set<string>([ADMIN_EMAIL]);
const users: SeedUser[] = [];
for (let i = 0; i < USER_COUNT; i++) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  let email = faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase();
  while (usedEmails.has(email)) email = email.replace('@', `${faker.number.int(99)}@`);
  usedEmails.add(email);

  users.push({
    id: faker.string.uuid(),
    email,
    firstName,
    lastName,
    phone: faker.datatype.boolean(0.9)
      ? `+1 ${faker.string.numeric(3)} ${faker.string.numeric(3)} ${faker.string.numeric(4)}`
      : null,
    about: faker.datatype.boolean(0.85)
      ? `${faker.person.jobTitle()} at ${faker.company.name()}. ${capitalize(faker.person.bio())}.`
      : null,
    createdAt: faker.date.between({ from: FROM, to: TO }),
  });
}

const admin: SeedUser = {
  id: faker.string.uuid(),
  email: ADMIN_EMAIL,
  firstName: 'Support',
  lastName: 'Agent',
  phone: null,
  about: 'Demo support agent (seed data).',
  createdAt: FROM,
};

const subjects = [
  'Cannot update my phone number',
  'Question about my account data',
  'How do I change my display name?',
  'Sign-in popup closes immediately',
  'Request to export my profile',
  'Feedback on the new dashboard',
  'Wrong surname in my profile',
  'Is my data shared with third parties?',
  'Page loads slowly on mobile',
  'Need help with notifications',
];

const userReplies = [
  'Thanks for the quick response!',
  'I tried that but it still does not work for me.',
  'Could you please check again? I attached details above.',
  'That solved it, thank you.',
];
const adminReplies = [
  'Thanks for reaching out! Could you share which browser you are using?',
  'We have fixed the issue on our side — please try again and let us know.',
  'You can update this from the profile panel on the help desk page.',
  'I have forwarded this to the engineering team and will update you shortly.',
];

type Status = 'open' | 'answered' | 'closed';
const tickets: {
  id: string;
  userId: string;
  subject: string;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
}[] = [];
const messages: {
  id: string;
  ticketId: string;
  authorId: string;
  role: 'user' | 'admin';
  body: string;
  createdAt: Date;
}[] = [];

for (const user of faker.helpers.arrayElements(users, TICKET_COUNT)) {
  const ticketId = faker.string.uuid();
  let at = faker.date.between({ from: user.createdAt, to: TO });
  const turns = faker.number.int({ min: 1, max: 4 });
  let lastRole: 'user' | 'admin' = 'user';

  for (let turn = 0; turn < turns; turn++) {
    const role = turn % 2 === 0 ? 'user' : 'admin';
    const body =
      turn === 0
        ? `${faker.lorem.sentences({ min: 2, max: 4 })}\n\nThanks, ${user.firstName}`
        : faker.helpers.arrayElement(role === 'admin' ? adminReplies : userReplies);
    messages.push({
      id: faker.string.uuid(),
      ticketId,
      authorId: role === 'admin' ? admin.id : user.id,
      role,
      body,
      createdAt: at,
    });
    lastRole = role;
    at = new Date(at.getTime() + faker.number.int({ min: 10, max: 48 * 60 }) * 60_000);
  }

  const lastAt = messages.at(-1)!.createdAt;
  const status: Status =
    lastRole === 'admin' && faker.datatype.boolean(0.4)
      ? 'closed'
      : lastRole === 'admin'
        ? 'answered'
        : 'open';
  tickets.push({
    id: ticketId,
    userId: user.id,
    subject: faker.helpers.arrayElement(subjects),
    status,
    createdAt: messages.find((m) => m.ticketId === ticketId)!.createdAt,
    updatedAt: lastAt,
  });
}

const BREAK = '\n--> statement-breakpoint\n';
const allUsers = [admin, ...users];

const sql = [
  `-- Generated by src/scripts/generate-seed.ts (faker seed ${SEED}). Do not edit by hand.
-- ${USER_COUNT} fake users (+ 1 support agent authoring sample replies), ${tickets.length} tickets.
INSERT INTO "users" ("id", "email", "first_name", "last_name", "phone", "about", "created_at", "updated_at") VALUES
${allUsers
  .map(
    (u) =>
      `  (${q(u.id)}, ${q(u.email)}, ${q(u.firstName)}, ${q(u.lastName)}, ${q(u.phone)}, ${q(u.about)}, ${ts(u.createdAt)}, ${ts(u.createdAt)})`,
  )
  .join(',\n')}
ON CONFLICT DO NOTHING;`,
  `INSERT INTO "tickets" ("id", "user_id", "subject", "status", "created_at", "updated_at") VALUES
${tickets
  .map(
    (t) =>
      `  (${q(t.id)}, ${q(t.userId)}, ${q(t.subject)}, ${q(t.status)}, ${ts(t.createdAt)}, ${ts(t.updatedAt)})`,
  )
  .join(',\n')}
ON CONFLICT DO NOTHING;`,
  `INSERT INTO "ticket_messages" ("id", "ticket_id", "author_id", "author_role", "body", "created_at") VALUES
${messages
  .map(
    (m) =>
      `  (${q(m.id)}, ${q(m.ticketId)}, ${m.role === 'admin' ? ADMIN_ID_SQL : q(m.authorId)}, ${q(m.role)}, ${q(m.body)}, ${ts(m.createdAt)})`,
  )
  .join(',\n')}
ON CONFLICT DO NOTHING;`,
].join(BREAK);

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle/0001_seed_fake_users.sql',
);
await writeFile(out, `${sql}\n`);
console.log(
  `Wrote ${allUsers.length} users, ${tickets.length} tickets, ${messages.length} messages → ${out}`,
);
