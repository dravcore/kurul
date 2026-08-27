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

/**
 * What just happened to this card, as the keyframes in `app/globals.css` name it: `returning` is
 * the landing after a move the server refused, `remote-changed` the fading tint on a card someone
 * else moved or edited.
 */
export type TaskCardSignal = 'returning' | 'remote-changed';

interface TaskCardProps {
  task: TaskDto;
  boardId: string;
  selected?: boolean;
  signal?: TaskCardSignal | null;
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

/**
 * One or two letters for an assignee's monogram. Left as-is rather than run through
 * `toUpperCase()`: a plain `.charAt(0)` on a name that is already capitalized (every seeded and
 * real name is) sidesteps the Turkish dotless-i case-mapping bug a locale-blind uppercase would
 * hit on a name like "ilker".
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`;
}

export function TaskCard({
  task,
  boardId,
  selected = false,
  signal = null,
  className,
}: TaskCardProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const tCard = useTranslations('app.board.card');
  const locale = useLocale();
  const assigneeNames = task.assignees.map((assignee) => assignee.name).join(', ');
  const overdue = task.dueDate !== null && utcCalendarDay(task.dueDate) < todayUtcCalendarDay();

  // `app.board.card.dueAndEstimate` is one ICU string, not two spans joined by a literal " · ":
  // `docs/design.md` §7 rules out concatenating sentence fragments, since word order and the
  // separator itself are language decisions. Falling back to whichever half exists keeps a card
  // with only a due date or only an estimate exactly as it rendered before this merged.
  const dueText = task.dueDate ? formatDueDate(task.dueDate, locale) : null;
  const estimateText =
    task.estimatedMinutes !== null ? formatEstimate(task.estimatedMinutes, t) : null;
  const dueAndEstimateText =
    dueText && estimateText
      ? tCard('dueAndEstimate', { due: dueText, estimate: estimateText })
      : (dueText ?? estimateText);

  const visibleAssignees = task.assignees.slice(0, 2);
  const hiddenAssigneeCount = task.assignees.length - visibleAssignees.length;

  return (
    <Link
      href={`/board/${boardId}/task/${task.id}`}
      data-slot="task-card"
      data-selected={selected || undefined}
      data-state={signal ?? undefined}
      className={cn(
        // `max-md:min-h-11`: a title-only card measures 36px, which is a fine density on a
        // desktop board and not a target a thumb can hit. Below `md` it grows to 44px.
        //
        // Only below `md`, deliberately. The 36-versus-56 gap between the measured title-only
        // height and `docs/design.md`'s figure for the same card is closed as of this change:
        // 56px is the measured typical card (one meta line, e.g. an estimate), not the title-only
        // floor, and `docs/design.md` and `sortable-task-card.tsx`'s `containIntrinsicSize` are
        // both updated in this commit to say so.
        // `border-l-2` is unconditional so the selected and unselected box are the same size:
        // a rail that only thickens on selection would shift the title text by a pixel the
        // moment a card is opened.
        'block rounded-md border border-border border-l-2 bg-card px-3 py-2 text-left transition-[color,background-color,border-color] max-md:min-h-11',
        // `border-l-signature` is a longhand (`border-left-color`) and `border-border` /
        // `hover:border-border-strong` are the shorthand (`border-color`); Tailwind emits every
        // side-specific longhand after the shorthands that touch the same property, so the left
        // edge keeps the signature colour no matter which order these classes are written here.
        // That is what keeps the rail to the selected card's own left edge while its other three
        // edges, and every edge of an unselected card, stay on the plain hairline.
        selected
          ? 'border-l-signature bg-signature-subtle'
          : 'hover:border-border-strong hover:bg-accent',
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
      {task.labels.length > 0 ||
      task.dueDate ||
      task.estimatedMinutes !== null ||
      task.assignees.length > 0 ||
      task.checklistSummary.total > 0 ||
      task.attachmentCount > 0 ? (
        <div
          data-slot="task-card-meta"
          className="mt-1.5 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-micro text-muted-foreground"
        >
          {/*
            One line, never two: at 300px this row used to hold five signals on `flex-wrap`,
            which meant a task with a checklist, an attachment, a due date, an estimate and an
            assignee wrapped onto a second line the column's intrinsic-size guess did not budget
            for. `flex-nowrap` forces the choice explicit instead, and the shrink priority below
            is that choice: label dots are the one purely decorative signal here (labels also
            have their own colour-coded chip in the task panel), so they are the only item that
            gives up width when the row is tight. Everything else is `shrink-0` and simply stays
            put: a task detail disappearing because a neighbour's title happened to be long would
            be a worse failure than a handful of label dots getting clipped.

            Every badge here is also a term in the condition above. The row is conditional, so a
            badge added to it without being added to that condition is invisible on exactly the
            card that has nothing else — which is the card it was added for.
          */}
          <LabelDots labels={task.labels} className="min-w-0 shrink flex-nowrap overflow-hidden" />
          <span className="shrink-0">
            <ChecklistBadge summary={task.checklistSummary} />
          </span>
          <span className="shrink-0">
            <AttachmentBadge count={task.attachmentCount} />
          </span>
          {dueAndEstimateText ? (
            <span className={cn('shrink-0', overdue && 'text-status-danger')}>
              {dueAndEstimateText}
            </span>
          ) : null}
          {task.assignees.length > 0 ? (
            <span className="flex shrink-0 items-center gap-1" title={assigneeNames}>
              <span className="sr-only">{assigneeNames}</span>
              {visibleAssignees.map((assignee) => (
                <span
                  key={assignee.userId}
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted leading-none text-foreground"
                >
                  {initials(assignee.name)}
                </span>
              ))}
              {hiddenAssigneeCount > 0 ? (
                <span aria-hidden>{tCard('moreAssignees', { count: hiddenAssigneeCount })}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
