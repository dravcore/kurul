'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface TaskPanelStatusProps {
  loading: boolean;
  loadError: string | null;
  onRetryLoad?: () => void;
  onClose: () => void;
}

/**
 * What the panel body shows when it has no task to show.
 *
 * Three answers, not two. A cold deep link (`/board/x/task/y`) opens the panel before the
 * board has the row, and folding that into `!task` flashed "This task no longer exists" at a
 * task that exists — the one sentence here that must never be a guess. Only the middle branch
 * is retryable: a 404 is the server being clear, and asking it again just repeats itself.
 * `loadError` is `null` for that case by contract.
 */
export function TaskPanelStatus({
  loading,
  loadError,
  onRetryLoad,
  onClose,
}: TaskPanelStatusProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const tErrors = useTranslations('app.errors');

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-destructive">{loadError}</p>
        <div className="flex flex-wrap gap-2">
          {onRetryLoad ? (
            <Button type="button" onClick={onRetryLoad}>
              {tErrors('retry')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {t('backToBoard')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-destructive">{t('missing')}</p>
      <Button type="button" variant="outline" onClick={onClose}>
        {t('backToBoard')}
      </Button>
    </div>
  );
}
