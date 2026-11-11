import { buildApp } from './app.ts';
import { createFirebaseVerifier } from './auth.ts';
import { loadEnv } from './config.ts';
import { createDb } from './db/client.ts';
import { loggerOptions } from './logger.ts';

const env = loadEnv();
const dbHandle = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

const app = await buildApp({
  env,
  db: dbHandle.db,
  pingDb: dbHandle.ping,
  verifier: createFirebaseVerifier(env.FIREBASE_PROJECT_ID),
  logger: loggerOptions(env),
});

app.addHook('onClose', () => dbHandle.close());

// Cloud Run sends SIGTERM and allows 10s before SIGKILL.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 9_000);
    timer.unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
