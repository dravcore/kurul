'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LabelDto, WorkspaceMemberDto } from '@kurul/shared-types';
import type { BoardTaskFilters } from '@/lib/task-query';
import {
  resolveDuePreset,
  setDueFilter,
  toggleAssigneeFilter,
  toggleLabelFilter,
  togglePriorityFilter,
} from './board-filter-actions';

interface FilterChip {
  key: string;
  label: string;
  /** The filter state this chip leaves behind once removed. */
  next: BoardTaskFilters;
}

interface BoardFilterChipsProps {
  filters: BoardTaskFilters;
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  onChange: (next: BoardTaskFilters) => void;
}

/**
 * The active filters, one removable chip each. Chips are derived from the filter state on
 * every render rather than tracked separately — the URL is the only place state lives.
 */
export function BoardFilterChips({
  filters,
  members,
  labels,
  onChange,
}: BoardFilterChipsProps): React.ReactElement | null {
  const t = useTranslations('app.board.filter');
  const tTask = useTranslations('app.board.task');

  const chips: FilterChip[] = [];

  if (filters.q) {
    chips.push({
      key: 'q',
      label: t('chipSearch', { q: filters.q }),
      next: { ...filters, q: undefined },
    });
  }

  for (const priority of filters.priority ?? []) {
    chips.push({
      key: `priority-${priority}`,
      label: tTask(`priorityValues.${priority}`),
      next: togglePriorityFilter(filters, priority),
    });
  }

  for (const assigneeId of filters.assigneeId ?? []) {
    const member = members.find((entry) => entry.userId === assigneeId);
    chips.push({
      key: assigneeId === 'null' ? 'assignee-null' : `assignee-${assigneeId}`,
      label: assigneeId === 'null' ? t('unassigned') : (member?.name ?? assigneeId),
      next: toggleAssigneeFilter(filters, assigneeId),
    });
  }

  for (const labelId of filters.labelId ?? []) {
    const label = labels.find((entry) => entry.id === labelId);
    chips.push({
      key: `label-${labelId}`,
      label: label?.name ?? labelId,
      next: toggleLabelFilter(filters, labelId),
    });
  }

  // The three due-date fields read as a single chip, so removing it clears all of them.
  const duePreset = resolveDuePreset(filters);
  if (duePreset) {
    const dueLabels = { none: 'noDueDate', overdue: 'overdue', range: 'dueRange' } as const;
    chips.push({
      key: `due-${duePreset}`,
      label: t(dueLabels[duePreset]),
      next: setDueFilter(filters, 'clear'),
    });
  }

  if (chips.length === 0) return null;

  // Both controls below take `max-md:min-h-11`. A chip is a 24px pill on desktop by design
  // (`docs/design.md` §4 — chips are `radius-sm`, read at a glance, and a row of them has to
  // stay a row), but on the mobile board it is a real control a thumb has to hit, and 24px is
  // not one. The pill grows; its text and radius do not.
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.next)}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm bg-muted px-2 text-micro text-foreground transition-[color,background-color,border-color] hover:bg-accent max-md:min-h-11 max-md:px-3"
        >
          <span className="truncate">{chip.label}</span>
          <X className="size-3 shrink-0 opacity-70" aria-hidden />
          <span className="sr-only">{t('removeChip', { label: chip.label })}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange({})}
        className="inline-flex items-center text-micro text-muted-foreground underline-offset-2 hover:underline max-md:min-h-11 max-md:px-2"
      >
        {t('clearAll')}
      </button>
    </div>
  );
}
