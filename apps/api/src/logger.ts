import type { FastifyServerOptions } from 'fastify';
import type { Env } from './config.ts';

/** pino levels → Cloud Logging severities, so logs are filterable in the console. */
const severity: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export function loggerOptions(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    messageKey: 'message',
    formatters: {
      level: (label) => ({ severity: severity[label] ?? 'DEFAULT' }),
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };
}
