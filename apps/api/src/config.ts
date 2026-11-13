import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  ADMIN_EMAILS: csv,
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_API_KEY: z.string().default(''),
  FIREBASE_AUTH_DOMAIN: z.string().default(''),
  FIREBASE_APP_ID: z.string().default(''),
  /** Directory with the built SPA. When absent, the API serves only /api. */
  WEB_DIST_DIR: z.string().optional(),
  // --- AI assistant (feature 002). Without GEMINI_API_KEY the assistant stays off.
  GEMINI_API_KEY: z.string().optional(),
  BOT_MODEL_ANSWER: z.string().default('gemini-3.8-flash'),
  BOT_MODEL_TRIAGE: z.string().default('gemini-3.5-flash-lite'),
  BOT_MODEL_EMBED: z.string().default('gemini-embedding-2'),
  /** projects/{p}/locations/{r}/queues/{q}; when unset tasks run in-process (local dev). */
  BOT_TASKS_QUEUE: z.string().optional(),
  BOT_TASKS_SA: z.string().optional(),
  /** Public URL of /internal/bot/tasks (Cloud Tasks target and OIDC audience). */
  BOT_TASKS_URL: z.url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
