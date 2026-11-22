import type { TicketStatus, TicketSummary } from '@app/shared';
import { clsx } from 'clsx';
import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { fullName, timeAgo } from '../lib/format.ts';
import { Avatar, StatusBadge } from './ui/index.tsx';

export function TicketList({
  tickets,
  hrefFor,
  showRequester = false,
}: {
  tickets: TicketSummary[];
  hrefFor: (t: TicketSummary) => string;
  showRequester?: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link
            to={hrefFor(t)}
            className="flex items-start gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-6 dark:hover:bg-slate-800/50"
          >
            {showRequester && <Avatar name={fullName(t.requester)} src={t.requester.avatarUrl} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{t.subject}</p>
                <StatusBadge status={t.status} audience={showRequester ? 'admin' : 'user'} />
              </div>
              {showRequester && (
                <p className="text-xs text-slate-500">
                  {fullName(t.requester)} · {t.requester.email}
                </p>
              )}
              {t.lastMessagePreview && (
                <p className="mt-1 line-clamp-1 text-sm text-slate-500">{t.lastMessagePreview}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-500">
              <time dateTime={t.updatedAt}>{timeAgo(t.updatedAt)}</time>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" aria-hidden />
                {t.messageCount}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const filters: { value: TicketStatus | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'pending_human', label: 'With support' },
  { value: 'answered', label: 'Answered' },
  { value: 'closed', label: 'Closed' },
];

export function StatusTabs({
  value,
  onChange,
  audience = 'user',
}: {
  value: TicketStatus | undefined;
  onChange: (v: TicketStatus | undefined) => void;
  audience?: 'user' | 'admin';
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter by status"
      className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
    >
      {filters.map((f) => (
        <button
          key={f.label}
          type="button"
          role="tab"
          aria-selected={value === f.value}
          onClick={() => {
            onChange(f.value);
          }}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === f.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
          )}
        >
          {f.value === 'pending_human' && audience === 'admin' ? 'Needs human' : f.label}
        </button>
      ))}
    </div>
  );
}
