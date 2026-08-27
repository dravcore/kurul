'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DamgaMark } from '@/components/brand/damga-mark';

/** What the board frame looks like before the first fetch resolves. */
export function BoardLoadingState(): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex gap-3 overflow-x-auto p-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-[var(--column-width)] shrink-0" />
        ))}
      </div>
    </div>
  );
}

export function BoardErrorState({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry?: () => void;
}): React.ReactElement {
  const t = useTranslations('app.board');
  const tErrors = useTranslations('app.errors');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-title text-destructive">{message ?? t('loadError')}</h1>
      {/* §6 spells this one out: "The board couldn't load. → Try again". Nothing here is
          explained, so the way out has to be a control, not a link away from the problem. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            {tErrors('retry')}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('backToBoards')}</Link>
        </Button>
      </div>
    </div>
  );
}

interface BoardColumnsEmptyStateProps {
  canMutateColumns: boolean;
  defaultsPending: boolean;
  onCreateColumn: () => void;
  onSeedDefaults: () => void;
}

/** A board with no columns yet: create one, or take the To Do / In Progress / Done set. */
export function BoardColumnsEmptyState({
  canMutateColumns,
  defaultsPending,
  onCreateColumn,
  onSeedDefaults,
}: BoardColumnsEmptyStateProps): React.ReactElement {
  const t = useTranslations('app.board');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <DamgaMark />
      <h2 className="font-display text-title-lg">{t('column.emptyTitle')}</h2>
      <p className="max-w-md text-body text-muted-foreground">{t('column.emptyBody')}</p>
      {canMutateColumns ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={onCreateColumn}>
            {t('column.createAction')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={defaultsPending}
            onClick={onSeedDefaults}
          >
            {t('column.useDefaults')}
          </Button>
        </div>
      ) : (
        <p className="text-body text-destructive">{t('column.forbidden')}</p>
      )}
    </div>
  );
}

interface BoardFilterEmptyStateProps {
  activeFilterCount: number;
  onClearFilters: () => void;
}

/** Columns exist, but the active filters match nothing. */
export function BoardFilterEmptyState({
  activeFilterCount,
  onClearFilters,
}: BoardFilterEmptyStateProps): React.ReactElement {
  const t = useTranslations('app.board.filter');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-title">{t('emptyTitle')}</h2>
      <p className="max-w-md text-body text-muted-foreground">
        {t('emptyBody', { count: activeFilterCount })}
      </p>
      <Button type="button" variant="outline" onClick={onClearFilters}>
        {t('clearAll')}
      </Button>
    </div>
  );
}
