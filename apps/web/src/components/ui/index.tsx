import type { TicketStatus } from '@app/shared';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

export { clsx as cn };

// ------------------------------------------------------------------ Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/60 dark:bg-brand-500 dark:hover:bg-brand-600',
  secondary:
    'bg-white text-slate-900 ring-1 ring-slate-300 ring-inset hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700',
  ghost: 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
        { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size],
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Form fields

const fieldBase =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 aria-[invalid=true]:ring-rose-500';

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        className={clsx(fieldBase, 'h-10', className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        className={clsx(fieldBase, 'min-h-24 resize-y', className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Field>
  );
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="search" className={clsx(fieldBase, 'h-10 max-w-sm')} {...props} />;
}

// ------------------------------------------------------------------ Layout bits

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center p-10 text-slate-500">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="rounded-full bg-brand-50 p-3 text-brand-600 dark:bg-brand-500/10 dark:text-brand-500">
        {icon}
      </div>
      <h3 className="font-medium">{title}</h3>
      {children && <div className="max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
    >
      {error instanceof Error ? error.message : 'Something went wrong'}
    </div>
  );
}

// ------------------------------------------------------------------ Data display

export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-14 text-lg' }[size];
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  if (src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={clsx(cls, 'rounded-full object-cover')}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={clsx(
        cls,
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-100',
      )}
    >
      {initials}
    </span>
  );
}

const statusStyles: Record<TicketStatus, string> = {
  open: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  answered: 'bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
  pending_human:
    'bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300',
  closed: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400',
};

export const statusLabel = (status: TicketStatus, audience: 'user' | 'admin' = 'user') =>
  status === 'pending_human'
    ? audience === 'admin'
      ? 'Needs human'
      : 'With support team'
    : status.charAt(0).toUpperCase() + status.slice(1);

export function StatusBadge({
  status,
  audience = 'user',
}: {
  status: TicketStatus;
  audience?: 'user' | 'admin';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        statusStyles[status],
      )}
    >
      {statusLabel(status, audience)}
    </span>
  );
}

/** Marks everything written by the AI assistant (spec D-Q2: always shown). */
export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-600 to-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
      AI assistant
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800"
    >
      <p className="text-slate-500">
        <span className="font-medium text-slate-900 dark:text-slate-100">{from}</span>–
        <span className="font-medium text-slate-900 dark:text-slate-100">{to}</span> of{' '}
        <span className="font-medium text-slate-900 dark:text-slate-100">{total}</span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onPage(page - 1);
          }}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onPage(page + 1);
          }}
          disabled={page >= pages}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
