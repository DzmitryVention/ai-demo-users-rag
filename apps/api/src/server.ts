import { buildApp } from './app.ts';
import { createGeminiLlm } from './bot/llm.ts';
import { DEMO_NOTICE } from './bot/pipeline.ts';
import {
  createCloudTasksQueue,
  createInlineQueue,
  createOidcVerifier,
  type BotQueue,
  type TaskAuthVerifier,
} from './bot/queue.ts';
import { handleTask, type BotRuntime } from './bot/runtime.ts';
import { createFirebaseVerifier } from './auth.ts';
import { loadEnv } from './config.ts';
import { createDb } from './db/client.ts';
import { loggerOptions } from './logger.ts';

const env = loadEnv();
const dbHandle = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

// ---- AI assistant wiring (feature 002)
const ai = env.GEMINI_API_KEY
  ? createGeminiLlm({
      apiKey: env.GEMINI_API_KEY,
      answerModel: env.BOT_MODEL_ANSWER,
      triageModel: env.BOT_MODEL_TRIAGE,
      embedModel: env.BOT_MODEL_EMBED,
    })
  : null;

const bot: BotRuntime = {
  ai,
  queue: { enqueue: async () => undefined },
  taskVerifier: null,
  demoNotice: DEMO_NOTICE,
};
let queue: BotQueue;
let taskVerifier: TaskAuthVerifier | null = null;
if (env.BOT_TASKS_QUEUE && env.BOT_TASKS_SA && env.BOT_TASKS_URL) {
  queue = createCloudTasksQueue({
    queuePath: env.BOT_TASKS_QUEUE,
    targetUrl: env.BOT_TASKS_URL,
    serviceAccountEmail: env.BOT_TASKS_SA,
  });
  taskVerifier = createOidcVerifier(env.BOT_TASKS_URL, env.BOT_TASKS_SA);
} else {
  // Local development: run assistant tasks in-process.
  queue = createInlineQueue((task) => handleTask(bot, dbHandle.db, app.log, task));
}
bot.queue = queue;
bot.taskVerifier = taskVerifier;

const app = await buildApp({
  env,
  db: dbHandle.db,
  pingDb: dbHandle.ping,
  verifier: createFirebaseVerifier(env.FIREBASE_PROJECT_ID),
  bot,
  logger: loggerOptions(env),
});
app.log.info(
  { ai: Boolean(ai), queue: env.BOT_TASKS_QUEUE ? 'cloud-tasks' : 'inline' },
  'assistant wiring',
);

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
