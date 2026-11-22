import {
  CreateMessageSchema,
  CreateTicketSchema,
  ErrorResponseSchema,
  FeedbackSchema,
  IdParamsSchema,
  ListTicketsQuerySchema,
  MeSchema,
  MessageParamsSchema,
  TicketDetailSchema,
  TicketListResponseSchema,
  UpdateProfileSchema,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { onTicketResolved, onUserMessage, type BotRuntime } from '../bot/runtime.ts';
import type { Database } from '../db/client.ts';
import { authOf } from '../plugins/auth.ts';
import * as ticketsService from '../services/tickets.ts';
import { toUser, updateProfile } from '../services/users.ts';

const errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
};
const security = [{ bearerAuth: [] }];

/** Routes available to every signed-in user, scoped to their own data. */
export const userRoutes: FastifyPluginAsyncZod<{ db: Database; bot: BotRuntime }> = async (
  app,
  { db, bot },
) => {
  app.get(
    '/me',
    { schema: { tags: ['me'], security, response: { 200: MeSchema, ...errors } } },
    async (req) => {
      const { user, role } = authOf(req);
      return { ...toUser(user), role };
    },
  );

  app.patch(
    '/me',
    {
      schema: {
        tags: ['me'],
        security,
        body: UpdateProfileSchema,
        response: { 200: MeSchema, ...errors },
      },
    },
    async (req) => {
      const { user, role } = authOf(req);
      const updated = await updateProfile(db, user.id, req.body);
      return { ...toUser(updated), role };
    },
  );

  app.get(
    '/tickets',
    {
      schema: {
        tags: ['tickets'],
        security,
        querystring: ListTicketsQuerySchema,
        response: { 200: TicketListResponseSchema, ...errors },
      },
    },
    async (req) => ticketsService.listTickets(db, { ...req.query, userId: authOf(req).user.id }),
  );

  app.post(
    '/tickets',
    {
      schema: {
        tags: ['tickets'],
        security,
        body: CreateTicketSchema,
        response: { 201: TicketDetailSchema, ...errors },
      },
    },
    async (req, reply) => {
      const { ticket, messageId } = await ticketsService.createTicket(
        db,
        authOf(req).user.id,
        req.body,
      );
      await onUserMessage(bot, db, req.log, ticket.id, messageId);
      return reply.code(201).send(await ticketsService.getTicket(db, ticket.id));
    },
  );

  app.get(
    '/tickets/:id',
    {
      schema: {
        tags: ['tickets'],
        security,
        params: IdParamsSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => ticketsService.getTicket(db, req.params.id, { ownerId: authOf(req).user.id }),
  );

  app.post(
    '/tickets/:id/messages',
    {
      schema: {
        tags: ['tickets'],
        security,
        params: IdParamsSchema,
        body: CreateMessageSchema,
        response: { 201: TicketDetailSchema, ...errors },
      },
    },
    async (req, reply) => {
      const { user } = authOf(req);
      // Always authored as "user" here, even for admins: this is the requester view.
      const { ticket, messageId } = await ticketsService.addMessage(
        db,
        req.params.id,
        { id: user.id, role: 'user' },
        req.body.body,
        { ownerId: user.id },
      );
      await onUserMessage(bot, db, req.log, ticket.id, messageId);
      return reply
        .code(201)
        .send(await ticketsService.getTicket(db, ticket.id, { ownerId: user.id }));
    },
  );

  app.post(
    '/tickets/:id/close',
    {
      schema: {
        tags: ['tickets'],
        security,
        params: IdParamsSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => {
      const ticket = await ticketsService.setTicketStatus(db, req.params.id, 'closed', {
        ownerId: authOf(req).user.id,
      });
      await onTicketResolved(bot, req.log, ticket.id);
      return ticket;
    },
  );

  app.post(
    '/tickets/:id/escalate',
    {
      schema: {
        tags: ['tickets'],
        security,
        params: IdParamsSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) =>
      ticketsService.escalateTicket(db, req.params.id, 'user_requested', {
        ownerId: authOf(req).user.id,
      }),
  );

  app.post(
    '/tickets/:id/messages/:messageId/feedback',
    {
      schema: {
        tags: ['tickets'],
        security,
        params: MessageParamsSchema,
        body: FeedbackSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) =>
      ticketsService.setFeedback(
        db,
        req.params.id,
        req.params.messageId,
        req.body.value,
        authOf(req).user.id,
      ),
  );
};
