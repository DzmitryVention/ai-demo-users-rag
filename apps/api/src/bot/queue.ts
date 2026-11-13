/**
 * Asynchronous work for the assistant (specs/002 plan § Architecture): Cloud Tasks in
 * production, an in-process runner for local development and tests.
 */
import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';

export type BotTask =
  { kind: 'run'; ticketId: string; messageId: string } | { kind: 'summary'; ticketId: string };

export interface BotQueue {
  enqueue(task: BotTask): Promise<void>;
}

export interface CloudTasksConfig {
  /** projects/{project}/locations/{region}/queues/{queue} */
  queuePath: string;
  /** Full URL of the internal endpoint, also used as the OIDC audience. */
  targetUrl: string;
  /** Service account whose OIDC token Cloud Tasks attaches. */
  serviceAccountEmail: string;
}

export function createCloudTasksQueue(config: CloudTasksConfig): BotQueue {
  const client = new CloudTasksClient();
  return {
    async enqueue(task) {
      // Named tasks are de-duplicated by Cloud Tasks: one run per message.
      const id =
        task.kind === 'run' ? `run-${task.messageId}` : `summary-${task.ticketId}-${Date.now()}`;
      try {
        await client.createTask({
          parent: config.queuePath,
          task: {
            name: `${config.queuePath}/tasks/${id}`,
            httpRequest: {
              httpMethod: 'POST',
              url: config.targetUrl,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(JSON.stringify(task)).toString('base64'),
              oidcToken: {
                serviceAccountEmail: config.serviceAccountEmail,
                audience: config.targetUrl,
              },
            },
          },
        });
      } catch (err) {
        // 6 = ALREADY_EXISTS: the task was enqueued before — fine (idempotent).
        if ((err as { code?: number }).code !== 6) throw err;
      }
    },
  };
}

/** Runs tasks in-process after the current request (local dev / tests). */
export function createInlineQueue(handler: (task: BotTask) => Promise<void>): BotQueue & {
  idle(): Promise<void>;
} {
  const pending = new Set<Promise<void>>();
  return {
    async enqueue(task) {
      const p = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => handler(task))
        .catch(() => undefined)
        .finally(() => pending.delete(p));
      pending.add(p);
    },
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

export interface TaskAuthVerifier {
  /** Throws unless the bearer token is a Google OIDC token for the tasks service account. */
  verify(authorization: string | undefined): Promise<void>;
}

export function createOidcVerifier(
  audience: string,
  serviceAccountEmail: string,
): TaskAuthVerifier {
  const client = new OAuth2Client();
  return {
    async verify(authorization) {
      const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
      if (!token) throw new Error('missing token');
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      if (!payload?.email_verified || payload.email !== serviceAccountEmail) {
        throw new Error('unexpected token subject');
      }
    },
  };
}
