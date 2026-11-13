import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusTabs, TicketList } from '../../components/TicketList.tsx';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
} from '../../components/ui/index.tsx';
import { api } from '../../lib/api.ts';
import { useDebounced, useListParams } from '../../lib/hooks.ts';

const PAGE_SIZE = 15;

export function AdminTicketsPage() {
  const { page, q, status, setPage, setQ, setStatus } = useListParams();
  const [search, setSearch] = useState(q);
  const debounced = useDebounced(search);
  useEffect(() => {
    if (debounced !== q) setQ(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync debounced input → URL only
  }, [debounced]);

  const query = useQuery({
    queryKey: ['admin', 'tickets', { page, q, status }],
    queryFn: () => api.admin.tickets({ page, pageSize: PAGE_SIZE, status, q: q || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader title="Support requests" description="Answer users and keep the queue moving." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StatusTabs value={status} onChange={setStatus} audience="admin" />
        <SearchInput
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          placeholder="Search subject…"
          aria-label="Search requests"
        />
      </div>
      <Card>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState icon={<Inbox className="size-6" />} title="Inbox zero 🎉">
            No requests match this filter.
          </EmptyState>
        ) : (
          <>
            <TicketList
              tickets={query.data.items}
              hrefFor={(t) => `/admin/tickets/${t.id}`}
              showRequester
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
