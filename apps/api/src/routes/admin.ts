import {
  AdminUserDetailSchema,
  BotOverviewSchema,
  BotRunListResponseSchema,
  BotSettingsSchema,
  CreateKbArticleSchema,
  CreateMessageSchema,
  ErrorResponseSchema,
  IdParamsSchema,
  KbArticleListSchema,
  KbArticleSchema,
  ListTicketsQuerySchema,
  ListUsersQuerySchema,
  PaginationQuerySchema,
  TicketDetailSchema,
  TicketListResponseSchema,
  ToggleBotSchema,
  UpdateKbArticleSchema,
  UpdateTicketStatusSchema,
  UserListResponseSchema,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as botAdmin from '../bot/admin.ts';
import { onTicketResolved, type BotRuntime } from '../bot/runtime.ts';
import type { Database } from '../db/client.ts';
import { AppError } from '../errors.ts';
import { authOf, requireAdmin } from '../plugins/auth.ts';
import * as ticketsService from '../services/tickets.ts';
import * as usersService from '../services/users.ts';

const errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
};
const security = [{ bearerAuth: [] }];
const admin = { tags: ['admin'], security };

/** Admin-only routes. Mounted under /admin behind `authenticate` + `requireAdmin`. */
export const adminRoutes: FastifyPluginAsyncZod<{ db: Database; bot: BotRuntime }> = async (
  app,
  { db, bot },
) => {
  app.addHook('onRequest', requireAdmin);

  // ------------------------------------------------------------ users

  app.get(
    '/users',
    {
      schema: {
        ...admin,
        querystring: ListUsersQuerySchema,
        response: { 200: UserListResponseSchema, ...errors },
      },
    },
    async (req) => usersService.listUsers(db, req.query),
  );

  app.get(
    '/users/:id',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        response: { 200: AdminUserDetailSchema, ...errors },
      },
    },
    async (req) => usersService.getUserDetail(db, req.params.id),
  );

  // ------------------------------------------------------------ tickets

  app.get(
    '/tickets',
    {
      schema: {
        ...admin,
        querystring: ListTicketsQuerySchema,
        response: { 200: TicketListResponseSchema, ...errors },
      },
    },
    async (req) => ticketsService.listTickets(db, req.query),
  );

  app.get(
    '/tickets/:id',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => ticketsService.getTicket(db, req.params.id, { includeInternal: true }),
  );

  app.post(
    '/tickets/:id/messages',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        body: CreateMessageSchema,
        response: { 201: TicketDetailSchema, ...errors },
      },
    },
    async (req, reply) => {
      const { ticket } = await ticketsService.addMessage(
        db,
        req.params.id,
        { id: authOf(req).user.id, role: 'admin' },
        req.body.body,
      );
      await onTicketResolved(bot, req.log, ticket.id);
      return reply
        .code(201)
        .send(await ticketsService.getTicket(db, ticket.id, { includeInternal: true }));
    },
  );

  app.patch(
    '/tickets/:id',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        body: UpdateTicketStatusSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => {
      await ticketsService.setTicketStatus(db, req.params.id, req.body.status);
      if (req.body.status === 'answered' || req.body.status === 'closed') {
        await onTicketResolved(bot, req.log, req.params.id);
      }
      return ticketsService.getTicket(db, req.params.id, { includeInternal: true });
    },
  );

  app.patch(
    '/tickets/:id/bot',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        body: ToggleBotSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => ticketsService.setBotEnabled(db, req.params.id, req.body.enabled),
  );

  // ------------------------------------------------------------ assistant

  app.get(
    '/bot/overview',
    { schema: { ...admin, response: { 200: BotOverviewSchema, ...errors } } },
    async () => botAdmin.getOverview(db),
  );

  app.put(
    '/bot/settings',
    {
      schema: {
        ...admin,
        body: BotSettingsSchema,
        response: { 200: BotSettingsSchema, ...errors },
      },
    },
    async (req) => botAdmin.updateSettings(db, req.body, authOf(req).user.id, bot.ai !== null),
  );

  app.get(
    '/bot/runs',
    {
      schema: {
        ...admin,
        querystring: PaginationQuerySchema.extend({ ticketId: z.uuid().optional() }),
        response: { 200: BotRunListResponseSchema, ...errors },
      },
    },
    async (req) => botAdmin.listRuns(db, req.query),
  );

  // ------------------------------------------------------------ knowledge articles

  app.get(
    '/kb/articles',
    { schema: { ...admin, response: { 200: KbArticleListSchema, ...errors } } },
    async () => ({ items: await botAdmin.listArticles(db) }),
  );

  app.post(
    '/kb/articles',
    {
      schema: {
        ...admin,
        body: CreateKbArticleSchema,
        response: { 201: KbArticleSchema, ...errors },
      },
    },
    async (req, reply) => {
      if (!bot.ai)
        throw new AppError(409, 'AI_NOT_CONFIGURED', 'The AI provider is not configured');
      const article = await botAdmin.createArticleFromTicket(
        db,
        bot.ai,
        req.body.ticketId,
        authOf(req).user.id,
      );
      return reply.code(201).send(article);
    },
  );

  app.patch(
    '/kb/articles/:id',
    {
      schema: {
        ...admin,
        params: IdParamsSchema,
        body: UpdateKbArticleSchema,
        response: { 200: KbArticleSchema, ...errors },
      },
    },
    async (req) => botAdmin.updateArticle(db, bot.ai, req.params.id, req.body, authOf(req).user.id),
  );
};
