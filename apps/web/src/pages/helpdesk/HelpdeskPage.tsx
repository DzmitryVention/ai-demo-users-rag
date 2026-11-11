import { CreateTicketSchema } from '@app/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Plus, X } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { StatusTabs, TicketList } from '../../components/TicketList.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui/index.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useListParams } from '../../lib/hooks.ts';

const PAGE_SIZE = 10;

function NewTicketDialog({ dialogRef }: { dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: api.tickets.create,
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.setQueryData(['ticket', ticket.id], ticket);
      dialogRef.current?.close();
      toast.success('Request sent', { description: 'Our team will get back to you soon.' });
      void navigate(`/help/tickets/${ticket.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = CreateTicketSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-ticket-title"
      className="m-auto w-full max-w-lg rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={onSubmit} className="space-y-5 p-6" noValidate>
        <div className="flex items-start justify-between">
          <div>
            <h2 id="new-ticket-title" className="text-lg font-semibold">
              New support request
            </h2>
            <p className="text-sm text-slate-500">Describe your issue and we&apos;ll reply here.</p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <TextField
          name="subject"
          label="Subject"
          placeholder="e.g. Cannot update my phone number"
          maxLength={200}
          error={errors['subject']}
          autoFocus
        />
        <TextAreaField
          name="body"
          label="Message"
          placeholder="Tell us what happened and what you expected…"
          rows={6}
          maxLength={5000}
          error={errors['body']}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Send request
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function HelpdeskPage() {
  const { me } = useAuth();
  const { page, status, setPage, setStatus } = useListParams();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const query = useQuery({
    queryKey: ['tickets', 'mine', { page, status }],
    queryFn: () => api.tickets.list({ page, pageSize: PAGE_SIZE, status }),
    placeholderData: keepPreviousData,
  });

  const openDialog = () => dialogRef.current?.showModal();

  return (
    <>
      <PageHeader
        title={`Hi ${me?.firstName ?? 'there'} 👋`}
        description="Your support requests and conversations with our team."
        actions={
          <Button onClick={openDialog}>
            <Plus className="size-4" aria-hidden /> New request
          </Button>
        }
      />

      <div className="mb-4">
        <StatusTabs value={status} onChange={setStatus} />
      </div>

      <Card>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState icon={<Inbox className="size-6" />} title="No requests yet">
            <p>Need help? Open a request and our support team will answer here.</p>
            <Button className="mt-4" onClick={openDialog}>
              <Plus className="size-4" aria-hidden /> New request
            </Button>
          </EmptyState>
        ) : (
          <>
            <TicketList tickets={query.data.items} hrefFor={(t) => `/help/tickets/${t.id}`} />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      <NewTicketDialog dialogRef={dialogRef} />
    </>
  );
}
