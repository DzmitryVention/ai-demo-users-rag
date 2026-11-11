import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
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
    refetchInterval: 30_000, // pick up support replies without a reload
  });

  const onSuccess = (data: Awaited<ReturnType<typeof api.tickets.get>>) => {
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

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState error={query.error} />;

  const ticket = query.data;
  return (
    <TicketConversation
      ticket={ticket}
      viewerRole="user"
      backTo="/help"
      backLabel="All requests"
      onReply={(body) => reply.mutateAsync(body)}
      replying={reply.isPending}
      replyHint={
        ticket.status === 'closed' ? 'Sending a message will re-open this request' : undefined
      }
      actions={
        ticket.status !== 'closed' && (
          <Button
            variant="secondary"
            onClick={() => {
              close.mutate();
            }}
            loading={close.isPending}
          >
            <CheckCircle2 className="size-4" aria-hidden /> Mark as resolved
          </Button>
        )
      }
    />
  );
}
