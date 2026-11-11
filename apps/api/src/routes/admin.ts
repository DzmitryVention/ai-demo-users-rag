import {
  AdminUserDetailSchema,
  CreateMessageSchema,
  ErrorResponseSchema,
  IdParamsSchema,
  ListTicketsQuerySchema,
  ListUsersQuerySchema,
  TicketDetailSchema,
  TicketListResponseSchema,
  UpdateTicketStatusSchema,
  UserListResponseSchema,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Database } from '../db/client.ts';
import { authOf, requireAdmin } from '../plugins/auth.ts';
import * as ticketsService from '../services/tickets.ts';
import * as usersService from '../services/users.ts';

const errors = { 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema };
const security = [{ bearerAuth: [] }];

/** Admin-only routes. Mounted under /admin behind `authenticate` + `requireAdmin`. */
export const adminRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/users',
    {
      schema: {
        tags: ['admin'],
        security,
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
        tags: ['admin'],
        security,
        params: IdParamsSchema,
        response: { 200: AdminUserDetailSchema, ...errors },
      },
    },
    async (req) => usersService.getUserDetail(db, req.params.id),
  );

  app.get(
    '/tickets',
    {
      schema: {
        tags: ['admin'],
        security,
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
        tags: ['admin'],
        security,
        params: IdParamsSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => ticketsService.getTicket(db, req.params.id),
  );

  app.post(
    '/tickets/:id/messages',
    {
      schema: {
        tags: ['admin'],
        security,
        params: IdParamsSchema,
        body: CreateMessageSchema,
        response: { 201: TicketDetailSchema, ...errors },
      },
    },
    async (req, reply) => {
      const ticket = await ticketsService.addMessage(
        db,
        req.params.id,
        { id: authOf(req).user.id, role: 'admin' },
        req.body.body,
      );
      return reply.code(201).send(ticket);
    },
  );

  app.patch(
    '/tickets/:id',
    {
      schema: {
        tags: ['admin'],
        security,
        params: IdParamsSchema,
        body: UpdateTicketStatusSchema,
        response: { 200: TicketDetailSchema, ...errors },
      },
    },
    async (req) => ticketsService.setTicketStatus(db, req.params.id, req.body.status),
  );
};
