'use client';

import { Filter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LabelDto, Priority, WorkspaceMemberDto } from '@kurultay/shared-types';
import { Priority as PriorityEnum } from '@kurultay/shared-types';
import { Button } from '@/components/ui/button';
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
import {
  resolveDuePreset,
  setDueFilter,
  toggleAssigneeFilter,
  toggleLabelFilter,
  togglePriorityFilter,
} from './board-filter-actions';
import { BoardFilterOptionGroup, type BoardFilterOption } from './board-filter-option-group';

const PRIORITIES = Object.values(PriorityEnum);

/** The unassigned bucket is a filter value like any other, not a separate flag. */
const UNASSIGNED_VALUE = 'null';

interface BoardFilterMenuProps {
  filters: BoardTaskFilters;
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  onChange: (next: BoardTaskFilters) => void;
}

/** The dropdown holding every filter that is not free-text search. */
export function BoardFilterMenu({
  filters,
  members,
  labels,
  onChange,
}: BoardFilterMenuProps): React.ReactElement {
  const t = useTranslations('app.board.filter');
  const tTask = useTranslations('app.board.task');
  const activeCount = countActiveFilters(filters);
  const duePreset = resolveDuePreset(filters);

  const priorityOptions: BoardFilterOption<Priority>[] = PRIORITIES.map((priority) => ({
    value: priority,
    label: tTask(`priorityValues.${priority}`),
  }));

  const assigneeOptions: BoardFilterOption[] = [
    { value: UNASSIGNED_VALUE, label: t('unassigned') },
    ...members.map((member) => ({ value: member.userId, label: member.name })),
  ];

  const labelOptions: BoardFilterOption[] = labels.map((label) => ({
    value: label.id,
    label: label.name,
  }));

  return (
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
        <BoardFilterOptionGroup
          heading={tTask('priority')}
          options={priorityOptions}
          selected={filters.priority}
          onToggle={(value) => onChange(togglePriorityFilter(filters, value))}
        />

        <DropdownMenuSeparator />
        <BoardFilterOptionGroup
          heading={tTask('assignees')}
          options={assigneeOptions}
          selected={filters.assigneeId}
          onToggle={(value) => onChange(toggleAssigneeFilter(filters, value))}
        />

        <DropdownMenuSeparator />
        <BoardFilterOptionGroup
          heading={tTask('labels')}
          options={labelOptions}
          selected={filters.labelId}
          emptyLabel={t('noLabels')}
          onToggle={(value) => onChange(toggleLabelFilter(filters, value))}
        />

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{tTask('dueDate')}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={duePreset === 'none'}
          onCheckedChange={(checked) => onChange(setDueFilter(filters, checked ? 'none' : 'clear'))}
        >
          {t('noDueDate')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={duePreset === 'overdue'}
          onCheckedChange={(checked) =>
            onChange(setDueFilter(filters, checked ? 'overdue' : 'clear'))
          }
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
  );
}
