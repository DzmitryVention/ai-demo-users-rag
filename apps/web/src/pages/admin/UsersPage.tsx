import type { ListUsersQuery } from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
} from '../../components/ui/index.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, fullName } from '../../lib/format.ts';
import { useDebounced, useListParams } from '../../lib/hooks.ts';

const PAGE_SIZE = 20;
type Sort = NonNullable<ListUsersQuery['sort']>;

function SortHeader({
  column,
  children,
  sort,
  order,
  onSort,
}: {
  column: Sort;
  children: string;
  sort: Sort;
  order: 'asc' | 'desc';
  onSort: (column: Sort) => void;
}) {
  const active = sort === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-4 py-3 text-left"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 font-medium uppercase hover:text-slate-900 dark:hover:text-slate-100"
      >
        {children}
        {active &&
          (order === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
      </button>
    </th>
  );
}

export function UsersPage() {
  const navigate = useNavigate();
  const { page, q, params, setPage, setQ, update } = useListParams();
  const sort =
    (['createdAt', 'lastName', 'email'] as const).find((s) => s === params.get('sort')) ??
    'createdAt';
  const order: 'asc' | 'desc' = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [search, setSearch] = useState(q);
  const debounced = useDebounced(search);
  useEffect(() => {
    if (debounced !== q) setQ(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync debounced input → URL only
  }, [debounced]);

  const query = useQuery({
    queryKey: ['admin', 'users', { page, q, sort, order }],
    queryFn: () => api.admin.users({ page, pageSize: PAGE_SIZE, q: q || undefined, sort, order }),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (column: Sort) => {
    const sameColumn = sort === column;
    const defaultOrder = column === 'createdAt' ? 'desc' : 'asc';
    update({
      sort: column,
      order: sameColumn ? (order === 'desc' ? 'asc' : 'desc') : defaultOrder,
      page: 1,
    });
  };
  const sortProps = { sort, order, onSort: toggleSort };

  return (
    <>
      <PageHeader
        title="Users"
        description={query.data ? `${query.data.total} people in the users pool` : 'The users pool'}
      />

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          placeholder="Search by name, email or phone…"
          aria-label="Search users"
        />
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-6" />} title="No users found">
            Try a different search.
          </EmptyState>
        ) : (
          <>
            <div
              className={clsx(
                'overflow-x-auto transition-opacity',
                query.isPlaceholderData && 'opacity-60',
              )}
            >
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase dark:bg-slate-800/50">
                  <tr>
                    <SortHeader {...sortProps} column="lastName">
                      Name
                    </SortHeader>
                    <SortHeader {...sortProps} column="email">
                      Email
                    </SortHeader>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                      Phone
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-left font-medium lg:table-cell"
                    >
                      About
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Requests
                    </th>
                    <SortHeader {...sortProps} column="createdAt">
                      Joined
                    </SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {query.data.items.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => void navigate(`/admin/users/${u.id}`)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/users/${u.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                          }}
                          className="flex items-center gap-3 font-medium whitespace-nowrap"
                        >
                          <Avatar name={fullName(u)} src={u.avatarUrl} size="sm" />
                          <span>
                            {u.firstName} <span className="text-slate-500">{u.lastName}</span>
                          </span>
                        </a>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{u.email}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {u.phone ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td
                        className="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell"
                        title={u.about ?? ''}
                      >
                        {u.about ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.ticketCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                        {formatDate(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
