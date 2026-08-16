'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ChecklistItemDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChecklistItemRowProps {
  item: ChecklistItemDto;
  /** A write is in flight; the row stays readable but nothing new can be started. */
  disabled?: boolean;
  onToggle: (itemId: string, isDone: boolean) => void;
  /** Omitted for a reader who cannot mutate the task — no disabled button, no button. */
  onRemove?: (itemId: string) => void;
}

/** One line of a checklist: the tick, the text, and the way to remove it. */
export function ChecklistItemRow({
  item,
  disabled = false,
  onToggle,
  onRemove,
}: ChecklistItemRowProps): React.ReactElement {
  const t = useTranslations('app.board.task.checklist');
  // Keyed on the item id rather than `useId`, so the association survives the list being
  // re-ordered or re-fetched: the row is the item, not the render.
  const inputId = `checklist-item-${item.id}`;

  return (
    <li className="group flex items-start gap-2">
      {/*
        The <label> below is what gives this checkbox its accessible name. A row that renders
        the text as a plain sibling leaves a screen reader announcing "checkbox, unchecked" and
        nothing else — and leaves the test with nothing to query by either.
      */}
      <input
        id={inputId}
        type="checkbox"
        className="mt-1 size-3.5 shrink-0 accent-signature"
        checked={item.isDone}
        disabled={disabled}
        onChange={(event) => onToggle(item.id, event.target.checked)}
      />
      <label
        htmlFor={inputId}
        className={cn(
          // `max-md:min-h-11` and `flex items-center`: the label is what a thumb aims at —
          // the checkbox beside it is a 14px native control that is not going to be resized
          // into a 44px square. The label toggles the same input (`htmlFor`), sits flush
          // against it, and is the box the mobile sweep in `e2e/tests/mobile-navigation.spec.ts`
          // measures for exactly that reason.
          'min-w-0 flex-1 cursor-pointer text-body break-words max-md:flex max-md:min-h-11 max-md:items-center',
          item.isDone && 'text-muted-foreground line-through',
        )}
      >
        {item.content}
      </label>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t('removeItem', { content: item.content })}
          onClick={() => onRemove(item.id)}
        >
          <X />
        </Button>
      ) : null}
    </li>
  );
}
