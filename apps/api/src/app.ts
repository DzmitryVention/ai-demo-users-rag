import { HealthSchema, PublicConfigSchema, type ErrorResponse } from '@app/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TokenVerifier } from './auth.ts';
import type { Env } from './config.ts';
import type { Database } from './db/client.ts';
import { AppError } from './errors.ts';
import { authenticate } from './plugins/auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { userRoutes } from './routes/user.ts';

export interface AppDeps {
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'ADMIN_EMAILS'
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_API_KEY'
    | 'FIREBASE_AUTH_DOMAIN'
    | 'FIREBASE_APP_ID'
    | 'WEB_DIST_DIR'
  >;
  db: Database;
  pingDb: () => Promise<boolean>;
  verifier: TokenVerifier;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ env, db, pingDb, verifier, logger = false }: AppDeps) {
  const app = Fastify({
    logger,
    trustProxy: true, // behind Google Front End on Cloud Run
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('auth', null);

  // ------------------------------------------------------------ security
  const authDomain = env.FIREBASE_AUTH_DOMAIN || `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`;
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        connectSrc: [
          "'self'",
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com',
          'https://www.googleapis.com',
        ],
        frameSrc: [`https://${authDomain}`, 'https://accounts.google.com'],
        fontSrc: ["'self'", 'data:'],
      },
    },
    // Firebase signInWithPopup needs to talk to its popup window.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
  });
  // The SPA is served from the same origin in production; CORS only for local dev.
  await app.register(cors, { origin: env.NODE_ENV === 'development' });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // ------------------------------------------------------------ OpenAPI
  await app.register(swagger, {
    openapi: {
      info: { title: 'Help desk API', version: '1.0.0' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });

  // ------------------------------------------------------------ errors
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.validation },
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    request.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong, please try again' } });
  });

  // ------------------------------------------------------------ API
  await app.register(
    async (api) => {
      api.get(
        '/health',
        { schema: { tags: ['system'], response: { 200: HealthSchema } } },
        async () => ({
          status: 'ok' as const,
          db: (await pingDb()) ? ('up' as const) : ('down' as const),
        }),
      );

      api.get(
        '/config',
        { schema: { tags: ['system'], response: { 200: PublicConfigSchema } } },
        async (_req, reply) => {
          reply.header('cache-control', 'public, max-age=300');
          return {
            firebase: {
              apiKey: env.FIREBASE_API_KEY,
              authDomain,
              projectId: env.FIREBASE_PROJECT_ID,
              appId: env.FIREBASE_APP_ID,
            },
          };
        },
      );

      api.get('/openapi.json', { schema: { hide: true } }, async () => api.swagger());

      await api.register(async (authed) => {
        authed.addHook('onRequest', authenticate({ db, verifier, adminEmails: env.ADMIN_EMAILS }));
        await authed.register(userRoutes, { db });
        await authed.register(adminRoutes, { db, prefix: '/admin' });
      });
    },
    { prefix: '/api' },
  );

  // ------------------------------------------------------------ SPA
  const webDir = env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : undefined;
  const serveSpa = webDir !== undefined && existsSync(path.join(webDir, 'index.html'));
  if (serveSpa) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      setHeaders: (res, filePath) => {
        res.header(
          'cache-control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api');
    if (!isApi && serveSpa && request.method === 'GET') {
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    }
    const body: ErrorResponse = {
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    };
    return reply.code(404).send(body);
  });

  return app;
}
