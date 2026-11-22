import type { FeedbackValue, TicketDetail } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, UserRound } from 'lucide-react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { TicketConversation } from '../../components/TicketConversation.tsx';
import { Button, ErrorState, Spinner } from '../../components/ui/index.tsx';
import { api, errorMessage } from '../../lib/api.ts';

export function TicketPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['ticket', id];

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.tickets.get(id),
    // Poll quickly while the assistant works, slowly otherwise (support replies).
    refetchInterval: (q) => {
      const state = q.state.data?.botState;
      return state === 'queued' || state === 'running' ? 2_000 : 30_000;
    },
  });

  const onSuccess = (data: TicketDetail) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };

  const reply = useMutation({
    mutationFn: (body: string) => api.tickets.reply(id, body),
    onSuccess,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = useMutation({
    mutationFn: () => api.tickets.close(id),
    onSuccess: (data) => {
      onSuccess(data);
      toast.success('Request closed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const escalate = useMutation({
    mutationFn: () => api.tickets.escalate(id),
    onSuccess: (data) => {
      onSuccess(data);
      toast.success('A person from our support team will reply here');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const feedback = useMutation({
    mutationFn: ({ messageId, value }: { messageId: string; value: FeedbackValue }) =>
      api.tickets.feedback(id, messageId, value),
    onSuccess,
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState error={query.error} />;

  const ticket = query.data;
  const canEscalate = ticket.status !== 'closed' && ticket.status !== 'pending_human';
  return (
    <TicketConversation
      ticket={ticket}
      viewerRole="user"
      backTo="/help"
      backLabel="All requests"
      onReply={(body) => reply.mutateAsync(body)}
      replying={reply.isPending}
      onFeedback={(messageId, value) => {
        feedback.mutate({ messageId, value });
      }}
      replyHint={
        ticket.status === 'closed'
          ? 'Sending a message will re-open this request'
          : ticket.status === 'pending_human'
            ? 'Our support team has your request and will reply here'
            : undefined
      }
      actions={
        <>
          {canEscalate && (
            <Button
              variant="secondary"
              onClick={() => {
                escalate.mutate();
              }}
              loading={escalate.isPending}
            >
              <UserRound className="size-4" aria-hidden /> Talk to a person
            </Button>
          )}
          {ticket.status !== 'closed' && (
            <Button
              variant="secondary"
              onClick={() => {
                close.mutate();
              }}
              loading={close.isPending}
            >
              <CheckCircle2 className="size-4" aria-hidden /> Mark as resolved
            </Button>
          )}
        </>
      }
    />
  );
}
