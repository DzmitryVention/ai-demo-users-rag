import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, Inbox, Mail, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { TicketList } from '../../components/TicketList.tsx';
import { Avatar, Card, EmptyState, ErrorState, Spinner } from '../../components/ui/index.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, fullName } from '../../lib/format.ts';

function Detail({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div>
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="text-sm break-all">{children}</dd>
      </div>
    </div>
  );
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.admin.user(id) });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState error={query.error} />;
  const user = query.data;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/admin/users"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="size-4" aria-hidden /> All users
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <Avatar name={fullName(user)} src={user.avatarUrl} size="lg" />
            <h1 className="mt-3 text-xl font-semibold">{fullName(user)}</h1>
          </div>
          <dl className="mt-6 space-y-4">
            <Detail icon={<Mail className="size-4" />} label="Email">
              <a
                href={`mailto:${user.email}`}
                className="text-brand-600 hover:underline dark:text-brand-500"
              >
                {user.email}
              </a>
            </Detail>
            <Detail icon={<Phone className="size-4" />} label="Phone">
              {user.phone ? <a href={`tel:${user.phone}`}>{user.phone}</a> : '—'}
            </Detail>
            <Detail icon={<Calendar className="size-4" />} label="Joined">
              {formatDate(user.createdAt)}
            </Detail>
          </dl>
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h2 className="text-xs text-slate-500">About</h2>
            <p className="mt-1 text-sm whitespace-pre-wrap">{user.about ?? '—'}</p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="border-b border-slate-200 px-6 py-4 font-semibold dark:border-slate-800">
            Support requests ({user.tickets.length})
          </h2>
          {user.tickets.length === 0 ? (
            <EmptyState icon={<Inbox className="size-6" />} title="No requests from this user" />
          ) : (
            <TicketList tickets={user.tickets} hrefFor={(t) => `/admin/tickets/${t.id}`} />
          )}
        </Card>
      </div>
    </div>
  );
}
