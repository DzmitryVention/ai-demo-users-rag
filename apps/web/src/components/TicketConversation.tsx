import { CreateMessageSchema, type TicketDetail } from '@app/shared';
import { clsx } from 'clsx';
import { ArrowLeft, Send } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { fullName, formatDateTime, timeAgo } from '../lib/format.ts';
import { Avatar, Button, Card, StatusBadge } from './ui/index.tsx';

interface Props {
  ticket: TicketDetail;
  /** Whose perspective: own messages are aligned right. */
  viewerRole: 'user' | 'admin';
  backTo: string;
  backLabel: string;
  onReply: (body: string) => Promise<unknown>;
  replying: boolean;
  actions?: ReactNode;
  replyHint?: string;
}

export function TicketConversation({
  ticket,
  viewerRole,
  backTo,
  backLabel,
  onReply,
  replying,
  actions,
  replyHint,
}: Props) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [ticket.messages.length]);

  const submit = async (e?: SubmitEvent) => {
    e?.preventDefault();
    const parsed = CreateMessageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    await onReply(parsed.data.body);
    setBody('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
  };

  const requester = fullName(ticket.requester);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={backTo}
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="size-4" aria-hidden /> {backLabel}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Opened by {requester} · {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      <ol className="space-y-4" aria-label="Conversation">
        {ticket.messages.map((m) => {
          const mine = m.authorRole === viewerRole;
          const name = m.authorRole === 'admin' ? 'Support team' : fullName(m.author);
          return (
            <li key={m.id} className={clsx('flex gap-3', mine && 'flex-row-reverse')}>
              <Avatar
                name={m.authorRole === 'admin' ? 'Support' : fullName(m.author)}
                src={m.author.avatarUrl}
                size="sm"
              />
              <div className={clsx('max-w-[85%] min-w-0', mine && 'text-right')}>
                <div className="mb-1 flex items-baseline gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{name}</span>
                  <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                    {timeAgo(m.createdAt)}
                  </time>
                </div>
                <div
                  className={clsx(
                    'rounded-2xl px-4 py-3 text-left text-sm whitespace-pre-wrap break-words',
                    mine
                      ? 'rounded-tr-sm bg-brand-600 text-white'
                      : 'rounded-tl-sm bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
                  )}
                >
                  {m.body}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />

      <Card className="mt-6 p-4">
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <label htmlFor="reply" className="sr-only">
            Your reply
          </label>
          <textarea
            id="reply"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={viewerRole === 'admin' ? `Reply to ${requester}…` : 'Write a follow-up…'}
            rows={3}
            maxLength={5000}
            aria-invalid={!!error}
            className="block w-full resize-y rounded-lg border-0 bg-transparent p-0 text-sm placeholder:text-slate-400 focus:ring-0 focus:outline-none"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">{replyHint ?? 'Press ⌘/Ctrl + Enter to send'}</p>
            <Button type="submit" loading={replying} disabled={!body.trim()}>
              {!replying && <Send className="size-4" aria-hidden />}
              Send
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
