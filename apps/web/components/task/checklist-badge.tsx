'use client';

import { SquareCheckBig } from 'lucide-react';
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
      {/*
        `SquareCheckBig` rather than a fuller checklist glyph on purpose. Lucide's `ListChecks`
        draws five SVG children; this one draws a single path. Measured on the seeded 1 000-task
        board with a checklist on every card, that difference is the badge costing 5.4 DOM nodes
        per mounted card instead of 8.4 — a board of 4 920 nodes instead of 5 520, against the
        3 841 it renders with no checklist anywhere. The glyph still says "checklist" and not
        "count", which is why it is not simply dropped.
      */}
      <SquareCheckBig className="size-3 shrink-0" aria-hidden />
      <span>
        {summary.done}/{summary.total}
      </span>
    </span>
  );
}
