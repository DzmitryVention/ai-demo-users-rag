import { CreateMessageSchema, type TicketDetail, type TicketMessage } from '@app/shared';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Info,
  Lock,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { Link } from 'react-router';
import { formatDateTime, fullName, timeAgo } from '../lib/format.ts';
import { AiBadge, Avatar, Button, Card, StatusBadge } from './ui/index.tsx';

interface Props {
  ticket: TicketDetail;
  /** Whose perspective: own messages are aligned right. */
  viewerRole: 'user' | 'admin';
  backTo: string;
  backLabel: string;
  onReply: (body: string) => Promise<unknown>;
  replying: boolean;
  actions?: ReactNode;
  replyHint?: string | undefined;
  /** Banner shown above the conversation (e.g. escalation reason for admins). */
  banner?: ReactNode;
  /** User view: rate assistant replies. */
  onFeedback?: ((messageId: string, value: 'helpful' | 'not_helpful') => void) | undefined;
}

function BotAvatar() {
  return (
    <span
      aria-hidden
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white"
    >
      <Bot className="size-4" />
    </span>
  );
}

function Citations({ message }: { message: TicketMessage }) {
  if (!message.citations.length && !message.notice) return null;
  return (
    <div className="mt-2 space-y-1.5 text-left">
      {message.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Sources">
          {message.citations.map((c) => (
            <span
              key={`${c.kind}:${c.title}`}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              <BookOpen className="size-3" aria-hidden />
              {c.kind === 'article' ? `Support knowledge base · ${c.title}` : c.title}
            </span>
          ))}
        </div>
      )}
      {message.notice && (
        <p className="flex items-start gap-1 text-xs text-slate-500">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          {message.notice}
        </p>
      )}
    </div>
  );
}

function Feedback({
  message,
  onFeedback,
}: {
  message: TicketMessage;
  onFeedback: (messageId: string, value: 'helpful' | 'not_helpful') => void;
}) {
  if (message.feedback) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        {message.feedback === 'helpful'
          ? 'Thanks for your feedback!'
          : 'Thanks — a person from our support team will follow up.'}
      </p>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
      <span className="mr-1">Was this helpful?</span>
      <button
        type="button"
        className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Helpful"
        onClick={() => {
          onFeedback(message.id, 'helpful');
        }}
      >
        <ThumbsUp className="size-4" />
      </button>
      <button
        type="button"
        className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Not helpful — talk to a person"
        onClick={() => {
          onFeedback(message.id, 'not_helpful');
        }}
      >
        <ThumbsDown className="size-4" />
      </button>
    </div>
  );
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
  banner,
  onFeedback,
}: Props) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [ticket.messages.length]);

  const submit = async (e?: SubmitEvent<HTMLFormElement>) => {
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

  const startFromDraft = (text: string) => {
    setBody(text);
    textareaRef.current?.focus();
  };

  const requester = fullName(ticket.requester);
  const botWorking = ticket.botState === 'queued' || ticket.botState === 'running';
  const persona =
    ticket.messages.find((m) => m.authorRole === 'bot')?.personaName ?? 'Our AI assistant';

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
            <StatusBadge status={ticket.status} audience={viewerRole} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Opened by {requester} · {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {banner}

      <ol className="space-y-4" aria-label="Conversation">
        {ticket.messages.map((m) => {
          const isBot = m.authorRole === 'bot';
          const mine = viewerRole === 'admin' ? m.authorRole === 'admin' : m.authorRole === 'user';
          const name = isBot
            ? (m.personaName ?? 'AI assistant')
            : m.authorRole === 'admin'
              ? 'Support team'
              : m.author
                ? fullName(m.author)
                : 'Customer';

          if (m.visibility === 'internal') {
            return (
              <li key={m.id}>
                <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-4 dark:border-violet-500/40 dark:bg-violet-500/5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-violet-800 dark:text-violet-300">
                    <Lock className="size-3.5" aria-hidden />
                    <span className="font-medium">Internal draft by {name}</span>
                    <AiBadge />
                    <span className="text-slate-500">· only admins can see this</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <Citations message={m} />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={() => {
                      startFromDraft(m.body);
                    }}
                  >
                    <Sparkles className="size-4" aria-hidden /> Use as reply
                  </Button>
                </div>
              </li>
            );
          }

          return (
            <li key={m.id} className={clsx('flex gap-3', mine && 'flex-row-reverse')}>
              {isBot ? (
                <BotAvatar />
              ) : (
                <Avatar
                  name={m.authorRole === 'admin' ? 'Support' : name}
                  src={m.author?.avatarUrl}
                  size="sm"
                />
              )}
              <div className={clsx('max-w-[85%] min-w-0', mine && 'text-right')}>
                <div
                  className={clsx(
                    'mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500',
                    mine && 'justify-end',
                  )}
                >
                  <span className="font-medium text-slate-700 dark:text-slate-300">{name}</span>
                  {isBot && <AiBadge />}
                  <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                    {timeAgo(m.createdAt)}
                  </time>
                </div>
                <div
                  className={clsx(
                    'rounded-2xl px-4 py-3 text-left text-sm break-words whitespace-pre-wrap',
                    mine
                      ? 'rounded-tr-sm bg-brand-600 text-white'
                      : isBot
                        ? 'rounded-tl-sm bg-gradient-to-br from-brand-50 to-fuchsia-50 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-fuchsia-500/10 dark:ring-brand-500/20'
                        : 'rounded-tl-sm bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
                  )}
                >
                  {m.body}
                </div>
                {isBot && <Citations message={m} />}
                {isBot && onFeedback && m.citations.length > 0 && (
                  <Feedback message={m} onFeedback={onFeedback} />
                )}
              </div>
            </li>
          );
        })}
        {botWorking && (
          <li className="flex gap-3" aria-live="polite">
            <BotAvatar />
            <div className="rounded-2xl rounded-tl-sm bg-gradient-to-br from-brand-50 to-fuchsia-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-fuchsia-500/10 dark:text-slate-300 dark:ring-brand-500/20">
              <span className="inline-flex items-center gap-2">
                <span className="flex gap-1" aria-hidden>
                  <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-brand-500" />
                </span>
                {persona.split(' ')[0]} is looking into it…
              </span>
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      <Card className="mt-6 p-4">
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <label htmlFor="reply" className="sr-only">
            Your reply
          </label>
          <textarea
            ref={textareaRef}
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
