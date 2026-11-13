import {
  ErrorResponseSchema,
  type AdminUserDetail,
  type BotOverview,
  type BotRunListResponse,
  type BotSettings,
  type FeedbackValue,
  type KbArticle,
  type UpdateKbArticleInput,
  type CreateTicketInput,
  type ListTicketsQuery,
  type ListUsersQuery,
  type Me,
  type PublicConfig,
  type TicketDetail,
  type TicketListResponse,
  type TicketStatus,
  type UpdateProfileInput,
  type UserListResponse,
} from '@app/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenProvider = () => Promise<string | null>;
let getToken: TokenProvider = async () => null;

/** Registered by the AuthProvider so every request carries a fresh ID token. */
export function setTokenProvider(provider: TokenProvider) {
  getToken = provider;
}

function toQuery(params: object = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  const token = await getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(data);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(res.status, code, message, details);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  config: () => request<PublicConfig>('/config'),
  me: () => request<Me>('/me'),
  updateMe: (input: UpdateProfileInput) => request<Me>('/me', { method: 'PATCH', json: input }),

  tickets: {
    list: (q: ListTicketsQuery) => request<TicketListResponse>(`/tickets${toQuery(q)}`),
    get: (id: string) => request<TicketDetail>(`/tickets/${id}`),
    create: (input: CreateTicketInput) =>
      request<TicketDetail>('/tickets', { method: 'POST', json: input }),
    reply: (id: string, body: string) =>
      request<TicketDetail>(`/tickets/${id}/messages`, { method: 'POST', json: { body } }),
    close: (id: string) => request<TicketDetail>(`/tickets/${id}/close`, { method: 'POST' }),
    escalate: (id: string) => request<TicketDetail>(`/tickets/${id}/escalate`, { method: 'POST' }),
    feedback: (id: string, messageId: string, value: FeedbackValue) =>
      request<TicketDetail>(`/tickets/${id}/messages/${messageId}/feedback`, {
        method: 'POST',
        json: { value },
      }),
  },

  admin: {
    users: (q: ListUsersQuery) => request<UserListResponse>(`/admin/users${toQuery(q)}`),
    user: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
    tickets: (q: ListTicketsQuery) => request<TicketListResponse>(`/admin/tickets${toQuery(q)}`),
    ticket: (id: string) => request<TicketDetail>(`/admin/tickets/${id}`),
    reply: (id: string, body: string) =>
      request<TicketDetail>(`/admin/tickets/${id}/messages`, { method: 'POST', json: { body } }),
    setStatus: (id: string, status: TicketStatus) =>
      request<TicketDetail>(`/admin/tickets/${id}`, { method: 'PATCH', json: { status } }),
    setBot: (id: string, enabled: boolean) =>
      request<TicketDetail>(`/admin/tickets/${id}/bot`, { method: 'PATCH', json: { enabled } }),
    botOverview: () => request<BotOverview>('/admin/bot/overview'),
    saveBotSettings: (settings: BotSettings) =>
      request<BotSettings>('/admin/bot/settings', { method: 'PUT', json: settings }),
    botRuns: (q: { page?: number; pageSize?: number; ticketId?: string }) =>
      request<BotRunListResponse>(`/admin/bot/runs${toQuery(q)}`),
    articles: () => request<{ items: KbArticle[] }>('/admin/kb/articles'),
    createArticle: (ticketId: string) =>
      request<KbArticle>('/admin/kb/articles', { method: 'POST', json: { ticketId } }),
    updateArticle: (id: string, input: UpdateKbArticleInput) =>
      request<KbArticle>(`/admin/kb/articles/${id}`, { method: 'PATCH', json: input }),
  },
};

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
