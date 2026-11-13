import {
  BotSettingsSchema,
  type BotSettings,
  type EscalationReason,
  type KbArticle,
} from '@app/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Archive, Bot, BookOpen, Check, Pencil, Wallet } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  AiBadge,
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
import { formatDateTime, timeAgo } from '../../lib/format.ts';
import { ESCALATION_LABELS } from './AdminTicketPage.tsx';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function SettingsForm({ settings }: { settings: BotSettings }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: api.admin.saveBotSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'bot'] });
      toast.success('Assistant settings saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = BotSettingsSchema.safeParse({
      mode: f.get('mode') === 'on' ? 'live' : 'off',
      personaName: f.get('personaName'),
      minRelevance: Number(f.get('minRelevance')),
      maxTurnsPerTicket: Number(f.get('maxTurnsPerTicket')),
      maxRunsPerUserPerDay: Number(f.get('maxRunsPerUserPerDay')),
      monthlyBudgetUsd: Number(f.get('monthlyBudgetUsd')),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 sm:col-span-2 dark:bg-slate-800/50">
        <span>
          <span className="block font-medium">Assistant answers customers</span>
          <span className="block text-sm text-slate-500">
            When off, every request goes straight to the support team.
          </span>
        </span>
        <input
          type="checkbox"
          name="mode"
          defaultChecked={settings.mode === 'live'}
          className="size-5 accent-brand-600"
        />
      </label>
      <TextField
        name="personaName"
        label="Persona name"
        defaultValue={settings.personaName}
        hint="Always shown with an “AI assistant” badge"
        error={errors['personaName']}
      />
      <TextField
        name="monthlyBudgetUsd"
        type="number"
        step="0.5"
        min={0}
        label="Monthly AI budget (USD)"
        defaultValue={settings.monthlyBudgetUsd}
        hint="The assistant switches off when reached"
        error={errors['monthlyBudgetUsd']}
      />
      <TextField
        name="minRelevance"
        type="number"
        step="0.01"
        min={0}
        max={1}
        label="Minimum relevance (0–1)"
        defaultValue={settings.minRelevance}
        hint="Below this similarity the request goes to a person"
        error={errors['minRelevance']}
      />
      <TextField
        name="maxTurnsPerTicket"
        type="number"
        min={1}
        max={10}
        label="Max assistant replies per request"
        defaultValue={settings.maxTurnsPerTicket}
        error={errors['maxTurnsPerTicket']}
      />
      <TextField
        name="maxRunsPerUserPerDay"
        type="number"
        min={1}
        label="Max assistant runs per customer per day"
        defaultValue={settings.maxRunsPerUserPerDay}
        error={errors['maxRunsPerUserPerDay']}
      />
      <div className="flex items-end justify-end sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function ArticleRow({ article }: { article: KbArticle }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.admin.updateArticle>[1]) =>
      api.admin.updateArticle(article.id, input),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'articles'] });
      toast.success('Article updated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (editing) {
    return (
      <li className="space-y-3 px-4 py-4 sm:px-6">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            update.mutate({
              question: (f.get('question') as string | null) ?? '',
              answer: (f.get('answer') as string | null) ?? '',
            });
          }}
        >
          <TextField
            name="question"
            label="Question"
            defaultValue={article.question}
            maxLength={500}
          />
          <TextAreaField
            name="answer"
            label="Answer"
            defaultValue={article.answer}
            rows={5}
            maxLength={3000}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start gap-4 px-4 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{article.question}</p>
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              article.status === 'approved' &&
                'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
              article.status === 'draft' &&
                'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
              article.status === 'archived' &&
                'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
            )}
          >
            {article.status}
          </span>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-400">
          {article.answer}
        </p>
        {article.sourceTicketId && (
          <Link
            to={`/admin/tickets/${article.sourceTicketId}`}
            className="mt-1 inline-block text-xs text-brand-600 hover:underline"
          >
            Source request
          </Link>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(true);
          }}
        >
          <Pencil className="size-4" aria-hidden /> Edit
        </Button>
        {article.status !== 'approved' && (
          <Button
            size="sm"
            loading={update.isPending}
            onClick={() => {
              update.mutate({ status: 'approved' });
            }}
          >
            <Check className="size-4" aria-hidden /> Approve
          </Button>
        )}
        {article.status !== 'archived' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              update.mutate({ status: 'archived' });
            }}
          >
            <Archive className="size-4" aria-hidden /> Archive
          </Button>
        )}
      </div>
    </li>
  );
}

export function AssistantPage() {
  const [runsPage, setRunsPage] = useState(1);
  const overview = useQuery({
    queryKey: ['admin', 'bot', 'overview'],
    queryFn: api.admin.botOverview,
    refetchInterval: 30_000,
  });
  const articles = useQuery({ queryKey: ['admin', 'articles'], queryFn: api.admin.articles });
  const runs = useQuery({
    queryKey: ['admin', 'bot', 'runs', runsPage],
    queryFn: () => api.admin.botRuns({ page: runsPage, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });

  if (overview.isPending) return <Spinner />;
  if (overview.isError) return <ErrorState error={overview.error} />;
  const o = overview.data;
  const resolved = o.runs30d.answered + o.runs30d.escalated;
  const autoRate = resolved ? Math.round((o.runs30d.answered / resolved) * 100) : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Bot className="size-6 text-brand-600" aria-hidden /> AI assistant
            <AiBadge />
          </span>
        }
        description={`${o.settings.personaName} answers questions from the knowledge base and hands everything else to your team.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Status"
          value={
            <span className={o.settings.mode === 'live' ? 'text-emerald-600' : 'text-slate-500'}>
              {o.settings.mode === 'live' ? 'On' : 'Off'}
            </span>
          }
          hint={`${o.pendingHuman} request(s) waiting for a person`}
        />
        <Stat
          label="AI spend this month"
          value={`$${o.monthSpendUsd.toFixed(2)}`}
          hint={
            <span className="inline-flex items-center gap-1">
              <Wallet className="size-3" aria-hidden /> budget $
              {o.settings.monthlyBudgetUsd.toFixed(2)}
            </span>
          }
        />
        <Stat
          label="Answered automatically (30 days)"
          value={`${autoRate}%`}
          hint={`${o.runs30d.answered} answered · ${o.runs30d.escalated} handed over`}
        />
        <Stat
          label="Customer feedback (30 days)"
          value={`👍 ${o.runs30d.helpful} · 👎 ${o.runs30d.notHelpful}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Settings</h2>
          <SettingsForm key={JSON.stringify(o.settings)} settings={o.settings} />
        </Card>
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <BookOpen className="size-4" aria-hidden /> Knowledge base
            </h2>
            {o.knowledgeBase ? (
              <dl className="space-y-1 text-sm">
                <div>{o.knowledgeBase.title}</div>
                <div className="text-slate-500">Edition {o.knowledgeBase.edition}</div>
                <div className="text-slate-500">
                  {o.knowledgeBase.sections} sections · {o.knowledgeBase.chunks} chunks
                </div>
                <div className="text-slate-500">Loaded {timeAgo(o.knowledgeBase.ingestedAt)}</div>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Not loaded yet — run the bot setup job.</p>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Why requests were handed over (30 days)</h2>
            {o.escalationReasons.length ? (
              <ul className="space-y-2 text-sm">
                {o.escalationReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-4">
                    <span className="text-slate-600 dark:text-slate-400">
                      {r.reason in ESCALATION_LABELS
                        ? ESCALATION_LABELS[r.reason as EscalationReason]
                        : r.reason}
                    </span>
                    <span className="font-medium tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Card id="articles">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="font-semibold">Knowledge articles</h2>
          <p className="text-xs text-slate-500">
            Create them from resolved requests with “Save as knowledge”.
          </p>
        </div>
        {articles.isPending ? (
          <Spinner />
        ) : articles.isError ? (
          <div className="p-4">
            <ErrorState error={articles.error} />
          </div>
        ) : articles.data.items.length === 0 ? (
          <EmptyState icon={<BookOpen className="size-6" />} title="No articles yet">
            Approved articles let the assistant reuse answers your team has written — without
            exposing the original customer.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {articles.data.items.map((a) => (
              <ArticleRow key={a.id} article={a} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-6 py-4 font-semibold dark:border-slate-800">
          Recent assistant runs
        </h2>
        {runs.isPending ? (
          <Spinner />
        ) : runs.isError ? (
          <div className="p-4">
            <ErrorState error={runs.error} />
          </div>
        ) : runs.data.items.length === 0 ? (
          <EmptyState icon={<Bot className="size-6" />} title="No runs yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Request</th>
                    <th className="px-4 py-3 font-medium">Outcome</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Top source</th>
                    <th className="px-4 py-3 text-right font-medium">Cost</th>
                    <th className="px-4 py-3 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {runs.data.items.map((r) => (
                    <tr key={r.id}>
                      <td
                        className="px-4 py-3 whitespace-nowrap text-slate-500"
                        title={formatDateTime(r.createdAt)}
                      >
                        {timeAgo(r.createdAt)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3">
                        <Link to={`/admin/tickets/${r.ticketId}`} className="hover:underline">
                          {r.ticketSubject}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {r.decision === 'answered' ? (
                          <span className="text-emerald-600">Answered</span>
                        ) : (
                          <span
                            className="text-violet-700 dark:text-violet-300"
                            title={r.escalationReason ?? ''}
                          >
                            Handed over
                            {r.escalationReason && (
                              <span className="block text-xs text-slate-500">
                                {ESCALATION_LABELS[r.escalationReason]}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell">
                        {r.sources[0]
                          ? `${r.sources[0].title} (${r.sources[0].score.toFixed(2)})`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">${r.costUsd.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                        {(r.latencyMs / 1000).toFixed(1)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={runsPage}
              pageSize={10}
              total={runs.data.total}
              onPage={setRunsPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
