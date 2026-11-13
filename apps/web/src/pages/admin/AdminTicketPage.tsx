import {
  TicketStatusSchema,
  type EscalationReason,
  type TicketDetail,
  type TicketStatus,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, BotOff, BookPlus, UserRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { TicketConversation } from '../../components/TicketConversation.tsx';
import { Button, ErrorState, Spinner, statusLabel } from '../../components/ui/index.tsx';
import { api, errorMessage } from '../../lib/api.ts';

export const ESCALATION_LABELS: Record<EscalationReason, string> = {
  no_relevant_source: 'No matching answer in the knowledge base',
  out_of_scope: 'Outside the assistant’s scope (account, billing, complaint…)',
  unsupported_language: 'Not written in English',
  injection_suspected: 'Possible manipulation attempt',
  abusive: 'Abusive language',
  user_requested: 'Customer asked for a person',
  not_helpful: 'Customer rated the assistant’s answer as not helpful',
  max_turns: 'Assistant reply limit reached for this request',
  quota_exceeded: 'Customer’s daily assistant limit reached',
  budget_exceeded: 'Monthly AI budget used up',
  model_refusal: 'Blocked by the AI provider’s safety filter',
  guardrail_failed: 'Answer failed the safety checks — see the draft',
  error: 'Technical error in the assistant',
};

export function AdminTicketPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ['admin', 'ticket', id];

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.admin.ticket(id),
    refetchInterval: (q) => {
      const state = q.state.data?.botState;
      return state === 'queued' || state === 'running' ? 2_000 : 30_000;
    },
  });

  const onSuccess = (data: TicketDetail) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'bot'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'user', data.requester.id] });
  };

  const reply = useMutation({
    mutationFn: (body: string) => api.admin.reply(id, body),
    onSuccess: (data) => {
      onSuccess(data);
      toast.success('Reply sent');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) => api.admin.setStatus(id, status),
    onSuccess,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const setBot = useMutation({
    mutationFn: (enabled: boolean) => api.admin.setBot(id, enabled),
    onSuccess: (data) => {
      onSuccess(data);
      toast.success(
        data.botState === 'disabled' ? 'You took over this request' : 'Assistant re-enabled',
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const saveArticle = useMutation({
    mutationFn: () => api.admin.createArticle(id),
    onSuccess: () => {
      toast.success('Draft article created — review it on the Assistant page');
      void navigate('/admin/assistant#articles');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState error={query.error} />;
  const ticket = query.data;
  const botOn = ticket.botState !== 'disabled';
  const resolved = ticket.status === 'answered' || ticket.status === 'closed';

  return (
    <TicketConversation
      ticket={ticket}
      viewerRole="admin"
      backTo="/admin/tickets"
      backLabel="All requests"
      onReply={(body) => reply.mutateAsync(body)}
      replying={reply.isPending}
      replyHint="Replying marks the request as answered and keeps the assistant out of it"
      banner={
        ticket.status === 'pending_human' && (
          <div className="mb-6 rounded-xl bg-violet-50 p-4 text-sm text-violet-900 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/30">
            <p className="font-medium">Needs a human reply</p>
            <p className="mt-0.5">
              {ticket.escalationReason
                ? ESCALATION_LABELS[ticket.escalationReason]
                : 'Escalated to the support team'}
            </p>
          </div>
        )
      }
      actions={
        <>
          <Link
            to={`/admin/users/${ticket.requester.id}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <UserRound className="size-4" aria-hidden /> Requester
          </Link>
          <Button
            variant="secondary"
            loading={setBot.isPending}
            onClick={() => {
              setBot.mutate(!botOn);
            }}
            title={
              botOn
                ? 'Stop the assistant from replying in this request'
                : 'Let the assistant reply again'
            }
          >
            {botOn ? (
              <BotOff className="size-4" aria-hidden />
            ) : (
              <Bot className="size-4" aria-hidden />
            )}
            {botOn ? 'Take over' : 'Hand back to assistant'}
          </Button>
          {resolved && (
            <Button
              variant="secondary"
              loading={saveArticle.isPending}
              onClick={() => {
                saveArticle.mutate();
              }}
            >
              <BookPlus className="size-4" aria-hidden /> Save as knowledge
            </Button>
          )}
          <label htmlFor="ticket-status" className="sr-only">
            Status
          </label>
          <select
            id="ticket-status"
            value={ticket.status}
            disabled={setStatus.isPending}
            onChange={(e) => {
              setStatus.mutate(TicketStatusSchema.parse(e.target.value));
            }}
            className="h-10 rounded-lg border-0 bg-white px-3 text-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-brand-500 dark:bg-slate-900 dark:ring-slate-700"
          >
            {TicketStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s, 'admin')}
              </option>
            ))}
          </select>
        </>
      }
    />
  );
}
