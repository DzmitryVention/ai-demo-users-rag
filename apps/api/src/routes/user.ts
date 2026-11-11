import {
  CreateMessageSchema,
  CreateTicketSchema,
  ErrorResponseSchema,
  IdParamsSchema,
  ListTicketsQuerySchema,
  MeSchema,
  TicketDetailSchema,
  TicketListResponseSchema,
  UpdateProfileSchema,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Database } from '../db/client.ts';
import { authOf } from '../plugins/auth.ts';
import * as ticketsService from '../services/tickets.ts';
import { toUser, updateProfile } from '../services/users.ts';

const errors = { 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema };
const security = [{ bearerAuth: [] }];

/** Routes available to every signed-in user, scoped to their own data. */
export const userRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
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
      const ticket = await ticketsService.createTicket(db, authOf(req).user.id, req.body);
      return reply.code(201).send(ticket);
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
      const ticket = await ticketsService.addMessage(
        db,
        req.params.id,
        { id: user.id, role: 'user' },
        req.body.body,
        { ownerId: user.id },
      );
      return reply.code(201).send(ticket);
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
    async (req) =>
      ticketsService.setTicketStatus(db, req.params.id, 'closed', {
        ownerId: authOf(req).user.id,
      }),
  );
};
