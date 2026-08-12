'use client';

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

export interface BoardFilterOption<TValue extends string = string> {
  /** The value stored in the filter list — a priority, a user id, or a label id. */
  value: TValue;
  label: string;
}

interface BoardFilterOptionGroupProps<TValue extends string> {
  heading: string;
  options: readonly BoardFilterOption<TValue>[];
  /** Currently selected values for this filter key. */
  selected: readonly TValue[] | undefined;
  /** Rendered as a disabled row when there is nothing to choose from. */
  emptyLabel?: string;
  onToggle: (value: TValue) => void;
}

/**
 * One multi-select section of the filter menu. Priorities, assignees and labels differ only
 * in the options they carry, so they share this group instead of three near-identical blocks.
 */
export function BoardFilterOptionGroup<TValue extends string>({
  heading,
  options,
  selected,
  emptyLabel,
  onToggle,
}: BoardFilterOptionGroupProps<TValue>): React.ReactElement {
  return (
    <>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {options.length === 0 && emptyLabel ? (
        <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
      ) : (
        options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected?.includes(option.value) ?? false}
            onCheckedChange={() => onToggle(option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))
      )}
    </>
  );
}
