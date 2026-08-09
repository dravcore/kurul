'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';
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
  const assigneeNames = task.assignees.map((assignee) => assignee.name).join(', ');
  const overdue = task.dueDate !== null && utcCalendarDay(task.dueDate) < todayUtcCalendarDay();

  return (
    <Link
      href={`/board/${boardId}/task/${task.id}`}
      data-rail-active={selected || undefined}
      className={cn(
        'block rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-left transition-colors',
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
      {task.dueDate || task.estimatedMinutes !== null || task.assignees.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
          {task.dueDate ? (
            <span className={cn(overdue && 'text-status-danger')}>
              {formatDueDate(task.dueDate, 'en')}
            </span>
          ) : null}
          {task.estimatedMinutes !== null ? (
            <span>{t('estimateMinutes', { minutes: task.estimatedMinutes })}</span>
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
