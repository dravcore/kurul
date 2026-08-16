'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { TaskDto } from '@kurul/shared-types';
import { formatEstimate } from '@/lib/duration';
import { cn } from '@/lib/utils';
import { AttachmentBadge } from './attachment-badge';
import { ChecklistBadge } from './checklist-badge';
import { LabelDots } from './label-chip';
import { PriorityIcon } from './priority-icon';

interface TaskCardProps {
  task: TaskDto;
  boardId: string;
  selected?: boolean;
  className?: string;
}

function formatDueDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function utcCalendarDay(iso: string): string {
  return iso.slice(0, 10);
}

function todayUtcCalendarDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TaskCard({
  task,
  boardId,
  selected = false,
  className,
}: TaskCardProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const locale = useLocale();
  const assigneeNames = task.assignees.map((assignee) => assignee.name).join(', ');
  const overdue = task.dueDate !== null && utcCalendarDay(task.dueDate) < todayUtcCalendarDay();

  return (
    <Link
      href={`/board/${boardId}/task/${task.id}`}
      data-selected={selected || undefined}
      className={cn(
        // `max-md:min-h-11`: a title-only card measures 36px, which is a fine density on a
        // desktop board and not a target a thumb can hit. Below `md` it grows to 44px.
        //
        // Only below `md`, deliberately. `docs/design.md` §4 says a card is "min 56px (title
        // only)" and the measured figure is 36 — the spec and the code have disagreed since
        // the card was written, and `board-column.tsx` records the 36 as measured fact in the
        // reasoning behind its `containIntrinsicSize`. Closing that gap changes desktop
        // density and invalidates a performance measurement; it is a real discrepancy and it
        // is not this change's to settle.
        'block rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-left transition-colors max-md:min-h-11',
        'hover:border-border-strong hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'border-signature bg-signature-subtle/40',
        className,
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="sr-only">{t('openTask')}</span>
      <span className="flex items-start gap-1.5">
        <PriorityIcon
          priority={task.priority}
          className="mt-0.5"
          title={t(`priorityValues.${task.priority}`)}
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-body text-foreground">{task.title}</span>
      </span>
      <LabelDots labels={task.labels} className="mt-1.5" />
      {task.dueDate ||
      task.estimatedMinutes !== null ||
      task.assignees.length > 0 ||
      task.checklistSummary.total > 0 ||
      task.attachmentCount > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
          {/*
            Kept inside the existing meta row rather than given a line of its own: the row is
            already the card's "everything else" strip, and a card that grows a second row per
            feature is the shape the column's 56px intrinsic-size guess was measured against.

            Every badge here is also a term in the condition above. The row is conditional, so a
            badge added to it without being added to that condition is invisible on exactly the
            card that has nothing else — which is the card it was added for.
          */}
          <ChecklistBadge summary={task.checklistSummary} />
          <AttachmentBadge count={task.attachmentCount} />
          {task.dueDate ? (
            <span className={cn(overdue && 'text-status-danger')}>
              {formatDueDate(task.dueDate, locale)}
            </span>
          ) : null}
          {task.estimatedMinutes !== null ? (
            <span>{formatEstimate(task.estimatedMinutes, t)}</span>
          ) : null}
          {assigneeNames ? (
            <span className="truncate" title={assigneeNames}>
              {assigneeNames}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
