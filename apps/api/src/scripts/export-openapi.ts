/**
 * Exports the OpenAPI contract (generated from the shared Zod schemas) to
 * specs/001-users-helpdesk/contracts/openapi.json.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.ts';
import type { Database } from '../db/client.ts';

const app = await buildApp({
  env: {
    NODE_ENV: 'test',
    ADMIN_EMAILS: [],
    FIREBASE_PROJECT_ID: 'contract-export',
    FIREBASE_API_KEY: '',
    FIREBASE_AUTH_DOMAIN: '',
    FIREBASE_APP_ID: '',
    WEB_DIST_DIR: undefined,
  },
  db: {} as Database, // never queried: we only read route schemas
  pingDb: async () => true,
  verifier: { verify: () => Promise.reject(new Error('unused')) },
});
await app.ready();

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../specs/001-users-helpdesk/contracts/openapi.json',
);
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`Wrote ${out}`);
