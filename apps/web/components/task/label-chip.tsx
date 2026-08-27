import type { LabelColorSlot, LabelDto } from '@kurul/shared-types';
import { cn } from '@/lib/utils';

const SLOT_CLASS: Record<LabelColorSlot, string> = {
  'slot-1': 'bg-label-slot-1',
  'slot-2': 'bg-label-slot-2',
  'slot-3': 'bg-label-slot-3',
  'slot-4': 'bg-label-slot-4',
  'slot-5': 'bg-label-slot-5',
  'slot-6': 'bg-label-slot-6',
  'slot-7': 'bg-label-slot-7',
  'slot-8': 'bg-label-slot-8',
};

interface LabelDotsProps {
  labels: LabelDto[];
  className?: string;
}

export function LabelDots({ labels, className }: LabelDotsProps): React.ReactElement | null {
  if (labels.length === 0) return null;
  const names = labels.map((label) => label.name).join(', ');
  return (
    <ul className={cn('flex flex-wrap gap-1', className)}>
      <li className="sr-only">{names}</li>
      {labels.map((label) => (
        <li
          key={label.id}
          title={label.name}
          aria-hidden
          className={cn('size-1.5 rounded-full', SLOT_CLASS[label.color])}
        />
      ))}
    </ul>
  );
}

/**
 * The chip shell every named thing in the panel wears: a label here, an assigned member in
 * `task-assignees-section.tsx`. One string, so the two cannot drift into two shapes for the same
 * job; the dot is the label's own addition on top of it.
 */
export const chipShell =
  'inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-small text-foreground';

type LabelChipProps = {
  label: LabelDto;
} & (
  { onRemove?: undefined; removeLabel?: undefined } | { onRemove: () => void; removeLabel: string }
);

export function LabelChip({ label, onRemove, removeLabel }: LabelChipProps): React.ReactElement {
  return (
    <span className={chipShell}>
      <span className={cn('size-1.5 rounded-full', SLOT_CLASS[label.color])} aria-hidden />
      <span>{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function labelSlotClass(color: LabelColorSlot): string {
  return SLOT_CLASS[color];
}
