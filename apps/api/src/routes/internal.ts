/**
 * Internal endpoints called by Cloud Tasks (specs/002 contracts/api.md § Internal).
 * Not under /api, not in OpenAPI, and only reachable with a Google OIDC token of the
 * tasks service account (security T8). Disabled when no verifier is configured.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { handleTask, type BotRuntime } from '../bot/runtime.ts';
import type { Database } from '../db/client.ts';
import { AppError, unauthorized } from '../errors.ts';

const TaskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), ticketId: z.uuid(), messageId: z.uuid() }),
  z.object({ kind: z.literal('summary'), ticketId: z.uuid() }),
]);

export const internalRoutes: FastifyPluginAsyncZod<{ db: Database; bot: BotRuntime }> = async (
  app,
  { db, bot },
) => {
  app.post(
    '/bot/tasks',
    { schema: { hide: true, body: TaskSchema }, config: { rateLimit: false } },
    async (req, reply) => {
      if (!bot.taskVerifier) throw new AppError(404, 'NOT_FOUND', 'Route not found');
      try {
        await bot.taskVerifier.verify(req.headers.authorization);
      } catch (err) {
        req.log.warn({ err }, 'rejected internal task call');
        throw unauthorized('Invalid task token');
      }
      // Business outcomes (answered / escalated / skipped) return 204 so Cloud Tasks does
      // not retry them; only unexpected infrastructure errors bubble up as 5xx.
      await handleTask(bot, db, req.log, req.body);
      return reply.code(204).send();
    },
  );
};
