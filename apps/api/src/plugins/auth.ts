import { isAdminEmail, type Role } from '@app/shared';
import type { FastifyRequest } from 'fastify';
import type { TokenVerifier } from '../auth.ts';
import type { Database } from '../db/client.ts';
import type { UserRow } from '../db/schema.ts';
import { AppError, forbidden, unauthorized } from '../errors.ts';
import { upsertFromIdentity } from '../services/users.ts';

export interface AuthContext {
  user: UserRow;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface AuthDeps {
  db: Database;
  verifier: TokenVerifier;
  adminEmails: readonly string[];
}

/** onRequest hook: verifies the bearer token and loads (or creates) the user. */
export function authenticate({ db, verifier, adminEmails }: AuthDeps) {
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw unauthorized();

    let identity;
    try {
      identity = await verifier.verify(match[1]);
    } catch (err) {
      request.log.info({ err }, 'id token rejected');
      throw unauthorized('Invalid or expired session, please sign in again');
    }

    if (!identity.email || !identity.emailVerified) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'A verified Google email is required');
    }

    const user = await upsertFromIdentity(db, identity);
    request.auth = { user, role: isAdminEmail(identity.email, adminEmails) ? 'admin' : 'user' };
  };
}

export async function requireAdmin(request: FastifyRequest) {
  if (request.auth?.role !== 'admin') throw forbidden();
}

/** Narrowing helper for handlers registered behind `authenticate`. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
