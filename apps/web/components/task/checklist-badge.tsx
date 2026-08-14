'use client';

import { ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ChecklistSummaryDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';

/**
 * Checklist progress on a board card.
 *
 * Renders nothing at all when the task has no checklist items — an empty badge is noise on a
 * surface P2-8 spent a whole task making cheap, and "no checklist" is the common case. Not a
 * hidden node, not a dash: zero nodes.
 *
 * Completion is carried by three channels, only one of which is colour: the ratio itself reads
 * `3/3` when everything is done, the icon says the number is a checklist rather than an
 * estimate or a count of comments, and the label spells the state out for assistive tech.
 * `docs/design.md` does not let colour be the only channel for meaning.
 */
export function ChecklistBadge({
  summary,
}: {
  summary: ChecklistSummaryDto;
}): React.ReactElement | null {
  const t = useTranslations('app.board.task.checklist');
  if (summary.total === 0) return null;

  const complete = summary.done === summary.total;
  return (
    <span
      className={cn('inline-flex items-center gap-1', complete && 'text-status-good')}
      aria-label={
        complete
          ? t('complete', { total: summary.total })
          : t('progress', { done: summary.done, total: summary.total })
      }
    >
      <ListChecks className="size-3 shrink-0" aria-hidden />
      <span>
        {summary.done}/{summary.total}
      </span>
    </span>
  );
}
