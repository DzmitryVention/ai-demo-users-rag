import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.ts';

/** Driver-agnostic database handle (node-postgres in prod, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createDb(url: string, poolMax: number): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Cloud Run instances are frozen between requests; keep sockets healthy.
    keepAlive: true,
  });

  const db = drizzle({ client: pool, schema, casing: 'snake_case' });

  return {
    db,
    ping: async () => {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
