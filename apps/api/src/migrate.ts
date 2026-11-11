/**
 * Applies pending SQL migrations from ./drizzle (schema + seed data).
 * Runs as the Cloud Run job `helpdesk-migrate` and locally via `npm run db:migrate`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');

// dist/migrate.js and src/migrate.ts both sit one level below the package root.
const migrationsFolder =
  process.env['MIGRATIONS_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const started = Date.now();
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  console.log(
    JSON.stringify({ severity: 'INFO', message: 'migrations applied', ms: Date.now() - started }),
  );
} catch (err) {
  console.error(
    JSON.stringify({ severity: 'ERROR', message: 'migration failed', error: String(err) }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
