import { TicketStatusSchema, type TicketStatus } from '@app/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(t);
    };
  }, [value, delay]);
  return debounced;
}

/** List state (page, q, status) kept in the URL so it survives reloads and is shareable. */
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  const statusParsed = TicketStatusSchema.safeParse(params.get('status'));
  const status: TicketStatus | undefined = statusParsed.success ? statusParsed.data : undefined;

  const update = (patch: Record<string, string | number | undefined>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || (k === 'page' && v === 1)) next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  };

  return {
    page,
    q,
    status,
    params,
    setPage: (p: number) => {
      update({ page: p });
    },
    setQ: (v: string) => {
      update({ q: v, page: 1 });
    },
    setStatus: (s: TicketStatus | undefined) => {
      update({ status: s, page: 1 });
    },
    update,
  };
}
