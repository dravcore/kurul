'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, DashboardSummaryDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { DamgaMark } from '@/components/brand/damga-mark';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from './stat-tile';

const PriorityChart = dynamic(() => import('./priority-chart').then((mod) => mod.PriorityChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />,
});
const AssigneeChart = dynamic(() => import('./assignee-chart').then((mod) => mod.AssigneeChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />,
});
const ColumnChart = dynamic(() => import('./column-chart').then((mod) => mod.ColumnChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />,
});
const CompletionChart = dynamic(
  () => import('./completion-chart').then((mod) => mod.CompletionChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" /> },
);

export function DashboardSummary(): React.ReactElement {
  const t = useTranslations('app.dashboard');
  const tErrors = useTranslations('app.errors');
  const { activeId } = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const boardIdParam = searchParams.get('boardId') ?? '';

  const fetchBoards = useMemo(
    () => (activeId ? () => fetchWorkspaceBoards(activeId) : null),
    [activeId],
  );
  // The board picker degrades to "all boards" rather than surfacing its own error row.
  const { data: boards } = useApiResource<BoardDto[]>(fetchBoards, [], '');

  const selectedBoardId = useMemo(() => {
    if (!boardIdParam) return '';
    return boards.some((board) => board.id === boardIdParam) ? boardIdParam : '';
  }, [boardIdParam, boards]);

  const fetchSummary = useMemo(() => {
    if (!activeId) return null;
    const qs = selectedBoardId ? `?${new URLSearchParams({ boardId: selectedBoardId })}` : '';
    return (signal: AbortSignal) =>
      api.get<DashboardSummaryDto>(`/workspaces/${activeId}/dashboard/summary${qs}`, { signal });
  }, [activeId, selectedBoardId]);
  const {
    data: summary,
    loading,
    error,
    reload,
  } = useApiResource<DashboardSummaryDto | null>(fetchSummary, null, t('loadError'));

  function onBoardChange(nextBoardId: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (nextBoardId) params.set('boardId', nextBoardId);
    else params.delete('boardId');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (loading && !summary) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
        </div>
        <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  // A summary that did not arrive is the retryable case: nothing about it is explained, so the
  // recovery is a control rather than a sentence (docs/design.md §7). `!summary` lands here too
  // — a successful response with no body is still a view with nothing in it to read.
  if (error || !summary) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-destructive">{error ?? t('loadError')}</p>
        <Button type="button" onClick={reload}>
          {tErrors('retry')}
        </Button>
      </div>
    );
  }

  if (summary.totalTasks === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <DamgaMark size={64} />
        <h2 className="font-display text-title-lg font-semibold">{t('emptyTitle')}</h2>
        <p className="max-w-md text-body text-muted-foreground">{t('emptyBody')}</p>
        {boards[0] ? (
          <Button asChild>
            <Link href={`/board/${boards[0].id}`}>{t('openBoard')}</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title">{t('overviewTitle')}</h2>
          <p className="text-small text-muted-foreground">{t('overviewBody')}</p>
        </div>
        <label className="flex flex-col gap-1 text-small">
          <span className="text-muted-foreground">{t('boardFilter')}</span>
          <Select
            className="min-w-[12rem]"
            value={selectedBoardId}
            onChange={(event) => onBoardChange(event.target.value)}
            aria-label={t('boardFilter')}
          >
            <option value="">{t('allBoards')}</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label={t('totalTasks')} value={summary.totalTasks} />
        <StatTile label={t('overdue')} value={summary.overdueCount} emphasize />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <PriorityChart data={summary.byPriority} />
        <AssigneeChart data={summary.byAssignee} />
      </div>

      {summary.byColumn ? <ColumnChart data={summary.byColumn} /> : null}

      <CompletionChart data={summary.throughput} />
    </div>
  );
}
