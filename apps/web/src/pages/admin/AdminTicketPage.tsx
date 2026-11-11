import { TicketStatusSchema, type TicketDetail, type TicketStatus } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { TicketConversation } from '../../components/TicketConversation.tsx';
import { ErrorState, Spinner } from '../../components/ui/index.tsx';
import { api, errorMessage } from '../../lib/api.ts';

export function AdminTicketPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['admin', 'ticket', id];

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.admin.ticket(id),
    refetchInterval: 30_000,
  });

  const onSuccess = (data: TicketDetail) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
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

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState error={query.error} />;
  const ticket = query.data;

  return (
    <TicketConversation
      ticket={ticket}
      viewerRole="admin"
      backTo="/admin/tickets"
      backLabel="All requests"
      onReply={(body) => reply.mutateAsync(body)}
      replying={reply.isPending}
      replyHint="Replying marks the request as answered"
      actions={
        <>
          <Link
            to={`/admin/users/${ticket.requester.id}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <UserRound className="size-4" aria-hidden /> Requester
          </Link>
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
            className="h-10 rounded-lg border-0 bg-white px-3 text-sm capitalize ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-brand-500 dark:bg-slate-900 dark:ring-slate-700"
          >
            {TicketStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </>
      }
    />
  );
}
