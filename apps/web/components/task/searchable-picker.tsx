'use client';

import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The most options a section still draws as a plain checkbox list.
 *
 * A popover costs a click before anything can be picked. On a small team that click buys
 * nothing: the whole roster already fits on screen and assigning is one press. Past this many
 * rows the list is the thing in the way, and a field to type into is worth the click. Both
 * sections read the same number so the panel never mixes the two shapes at the same size.
 */
export const INLINE_PICKER_MAX = 7;

export interface PickerOption {
  id: string;
  name: string;
  selected: boolean;
  /** A colour dot or other mark drawn between the checkbox and the name. */
  accent?: React.ReactNode;
  /** A per-row control drawn after the name, such as the board-label delete. */
  trailing?: React.ReactNode;
}

interface SearchablePickerProps {
  /** Already-translated trigger copy, count included. */
  triggerLabel: string;
  /** Names the filter field, stands in as its placeholder, and names the popover surface. */
  searchLabel: string;
  emptyLabel: string;
  options: PickerOption[];
  disabled: boolean;
  onToggle: (id: string, selected: boolean) => void;
}

/**
 * The long-list half of the threshold: a trigger, a filter field, and the same native checkbox
 * rows the short list draws.
 *
 * The rows stay real `<input type="checkbox">` elements rather than an ARIA listbox, so the
 * checked state, `Space`, the tab order and the focus outline are all the platform's. What is
 * added on top is one keyboard path a plain list does not have: `ArrowDown` from the filter
 * field steps into the rows and `ArrowUp` walks back out to it, so a reader who has typed can
 * reach a match without tabbing through the field first. `Enter` toggles the focused row, which
 * a bare checkbox does not do.
 */
export function SearchablePicker({
  triggerLabel,
  searchLabel,
  emptyLabel,
  options,
  disabled,
  onToggle,
}: SearchablePickerProps): React.ReactElement {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Folded in the reader's own locale, not with `toLowerCase()`. Turkish pairs `İ` with `i` and
  // `I` with `ı`, so the invariant fold turns "İbrahim" into `i` + U+0307 and leaves "Işıl" as
  // "işıl": a member typing their colleague's name gets an empty list and no reason for it.
  const fold = (value: string): string => value.toLocaleLowerCase(locale);
  const needle = fold(query.trim());
  const shown =
    needle === '' ? options : options.filter((option) => fold(option.name).includes(needle));

  function boxes(): HTMLInputElement[] {
    return Array.from(
      listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [],
    );
  }

  /** `-1` is the filter field, which is where `ArrowUp` off the first row lands. */
  function focusRow(index: number): void {
    if (index < 0) {
      searchRef.current?.focus();
      return;
    }
    const rows = boxes();
    rows[Math.min(index, rows.length - 1)]?.focus();
  }

  function onRowKeyDown(event: React.KeyboardEvent<HTMLInputElement>, option: PickerOption): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const current = boxes().indexOf(event.currentTarget);
      focusRow(event.key === 'ArrowDown' ? current + 1 : current - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onToggle(option.id, option.selected);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A query left behind would hide most of the list the next time the picker opens, with
        // nothing on screen to say why.
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={searchLabel} className="flex flex-col gap-2">
        <Input
          ref={searchRef}
          type="search"
          value={query}
          aria-label={searchLabel}
          placeholder={searchLabel}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            focusRow(0);
          }}
        />
        {shown.length === 0 ? (
          <p className="text-small text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul ref={listRef} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {shown.map((option) => (
              <li key={option.id} className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-body max-md:min-h-11">
                  <input
                    type="checkbox"
                    checked={option.selected}
                    disabled={disabled}
                    onChange={() => onToggle(option.id, option.selected)}
                    onKeyDown={(event) => onRowKeyDown(event, option)}
                  />
                  {option.accent}
                  <span className="truncate">{option.name}</span>
                </label>
                {option.trailing}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
