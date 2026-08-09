'use client';

import { Filter, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LabelDto, Priority, WorkspaceMemberDto } from '@kurultay/shared-types';
import { Priority as PriorityEnum } from '@kurultay/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { countActiveFilters, hasActiveFilters, type BoardTaskFilters } from '@/lib/task-query';

const PRIORITIES = Object.values(PriorityEnum);

export function BoardFilters({
  filters,
  members,
  labels,
  onChange,
}: Readonly<{
  filters: BoardTaskFilters;
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  onChange: (next: BoardTaskFilters) => void;
}>): React.ReactElement {
  const t = useTranslations('app.board.filter');
  const tTask = useTranslations('app.board.task');
  const searchRef = useRef<HTMLInputElement>(null);
  const [draftQ, setDraftQ] = useState(filters.q ?? '');
  const activeCount = countActiveFilters(filters);

  useEffect(() => {
    setDraftQ(filters.q ?? '');
  }, [filters.q]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function commitSearch(value: string): void {
    const trimmed = value.trim();
    onChange({ ...filters, q: trimmed || undefined });
  }

  function togglePriority(priority: Priority): void {
    const current = new Set(filters.priority ?? []);
    if (current.has(priority)) current.delete(priority);
    else current.add(priority);
    onChange({
      ...filters,
      priority: current.size > 0 ? [...current] : undefined,
    });
  }

  function toggleAssignee(userId: string): void {
    const current = new Set(filters.assigneeId ?? []);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    onChange({
      ...filters,
      assigneeId: current.size > 0 ? [...current] : undefined,
    });
  }

  function toggleLabel(labelId: string): void {
    const current = new Set(filters.labelId ?? []);
    if (current.has(labelId)) current.delete(labelId);
    else current.add(labelId);
    onChange({
      ...filters,
      labelId: current.size > 0 ? [...current] : undefined,
    });
  }

  function setDuePreset(preset: 'none' | 'overdue' | 'clear'): void {
    if (preset === 'clear') {
      onChange({
        ...filters,
        dueDateNull: undefined,
        dueDateGte: undefined,
        dueDateLte: undefined,
      });
      return;
    }
    if (preset === 'none') {
      onChange({
        ...filters,
        dueDateNull: true,
        dueDateGte: undefined,
        dueDateLte: undefined,
      });
      return;
    }
    onChange({
      ...filters,
      dueDateNull: undefined,
      dueDateGte: undefined,
      dueDateLte: new Date().toISOString(),
    });
  }

  const chips: Array<{ key: string; label: string; clear: () => void }> = [];

  if (filters.q) {
    chips.push({
      key: 'q',
      label: t('chipSearch', { q: filters.q }),
      clear: () => onChange({ ...filters, q: undefined }),
    });
  }

  for (const priority of filters.priority ?? []) {
    chips.push({
      key: `priority-${priority}`,
      label: tTask(`priorityValues.${priority}`),
      clear: () => togglePriority(priority),
    });
  }

  for (const assigneeId of filters.assigneeId ?? []) {
    if (assigneeId === 'null') {
      chips.push({
        key: 'assignee-null',
        label: t('unassigned'),
        clear: () => toggleAssignee('null'),
      });
      continue;
    }
    const member = members.find((entry) => entry.userId === assigneeId);
    chips.push({
      key: `assignee-${assigneeId}`,
      label: member?.name ?? assigneeId,
      clear: () => toggleAssignee(assigneeId),
    });
  }

  for (const labelId of filters.labelId ?? []) {
    const label = labels.find((entry) => entry.id === labelId);
    chips.push({
      key: `label-${labelId}`,
      label: label?.name ?? labelId,
      clear: () => toggleLabel(labelId),
    });
  }

  if (filters.dueDateNull) {
    chips.push({
      key: 'due-null',
      label: t('noDueDate'),
      clear: () => setDuePreset('clear'),
    });
  } else if (filters.dueDateLte && !filters.dueDateGte) {
    chips.push({
      key: 'due-overdue',
      label: t('overdue'),
      clear: () => setDuePreset('clear'),
    });
  } else if (filters.dueDateGte || filters.dueDateLte) {
    chips.push({
      key: 'due-range',
      label: t('dueRange'),
      clear: () => setDuePreset('clear'),
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1 max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={draftQ}
            onChange={(event) => setDraftQ(event.target.value)}
            onBlur={() => commitSearch(draftQ)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitSearch(draftQ);
              }
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="h-8 pl-7 text-small"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5">
              <Filter className="size-3.5" />
              {t('filters')}
              {activeCount > 0 ? (
                <span className="rounded-sm bg-muted px-1 text-micro font-medium tabular-nums">
                  {activeCount}
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{tTask('priority')}</DropdownMenuLabel>
            {PRIORITIES.map((priority) => (
              <DropdownMenuCheckboxItem
                key={priority}
                checked={filters.priority?.includes(priority) ?? false}
                onCheckedChange={() => togglePriority(priority)}
              >
                {tTask(`priorityValues.${priority}`)}
              </DropdownMenuCheckboxItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tTask('assignees')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={filters.assigneeId?.includes('null') ?? false}
              onCheckedChange={() => toggleAssignee('null')}
            >
              {t('unassigned')}
            </DropdownMenuCheckboxItem>
            {members.map((member) => (
              <DropdownMenuCheckboxItem
                key={member.userId}
                checked={filters.assigneeId?.includes(member.userId) ?? false}
                onCheckedChange={() => toggleAssignee(member.userId)}
              >
                {member.name}
              </DropdownMenuCheckboxItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tTask('labels')}</DropdownMenuLabel>
            {labels.length === 0 ? (
              <DropdownMenuItem disabled>{t('noLabels')}</DropdownMenuItem>
            ) : (
              labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={filters.labelId?.includes(label.id) ?? false}
                  onCheckedChange={() => toggleLabel(label.id)}
                >
                  {label.name}
                </DropdownMenuCheckboxItem>
              ))
            )}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tTask('dueDate')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={Boolean(filters.dueDateNull)}
              onCheckedChange={(checked) => setDuePreset(checked ? 'none' : 'clear')}
            >
              {t('noDueDate')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={Boolean(filters.dueDateLte && !filters.dueDateNull && !filters.dueDateGte)}
              onCheckedChange={(checked) => setDuePreset(checked ? 'overdue' : 'clear')}
            >
              {t('overdue')}
            </DropdownMenuCheckboxItem>

            {hasActiveFilters(filters) ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onChange({})}>{t('clearAll')}</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm bg-muted px-2 text-micro text-foreground transition-colors hover:bg-accent"
            >
              <span className="truncate">{chip.label}</span>
              <X className="size-3 shrink-0 opacity-70" aria-hidden />
              <span className="sr-only">{t('removeChip', { label: chip.label })}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-micro text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('clearAll')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
