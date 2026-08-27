'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LabelColorSlot, type LabelDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LabelChip, labelSlotClass } from './label-chip';
import { INLINE_PICKER_MAX, SearchablePicker } from './searchable-picker';

const SLOTS = Object.values(LabelColorSlot);

interface TaskLabelsSectionProps {
  taskLabels: LabelDto[];
  boardLabels: LabelDto[];
  canMutate: boolean;
  canManageLabels: boolean;
  pending: boolean;
  onToggleLabel: (labelId: string, assigned: boolean) => void;
  onDeleteBoardLabel: (labelId: string) => void;
  /** Resolves `true` once the label exists, which is when the name field is cleared. */
  onCreateLabel: (name: string, color: LabelColorSlot) => Promise<boolean>;
}

/** Labels on this task, the board's palette, and the create form for admins. */
export function TaskLabelsSection({
  taskLabels,
  boardLabels,
  canMutate,
  canManageLabels,
  pending,
  onToggleLabel,
  onDeleteBoardLabel,
  onCreateLabel,
}: TaskLabelsSectionProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const labelNameId = useId();
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<LabelColorSlot>(LabelColorSlot['slot-1']);
  const [pickerOpen, setPickerOpen] = useState(false);

  const taskLabelIds = new Set(taskLabels.map((label) => label.id));

  // Latched rather than read fresh every render: deleting a board label from inside the open
  // popover can carry `boardLabels.length` across `INLINE_PICKER_MAX` (8 down to 7, exactly the
  // boundary), and flipping shape mid-interaction would unmount the popover, and the delete
  // control the reader's focus was just on, out from under them. The decision is free to track
  // the current count again once the popover is closed, which is when a shape change is safe.
  const shouldUsePopover = boardLabels.length > INLINE_PICKER_MAX;
  const [popoverLatched, setPopoverLatched] = useState(shouldUsePopover);
  if (!pickerOpen && popoverLatched !== shouldUsePopover) {
    setPopoverLatched(shouldUsePopover);
  }

  async function createLabel(): Promise<void> {
    const name = newLabelName.trim();
    if (name.length === 0) return;
    const created = await onCreateLabel(name, newLabelColor);
    if (created) setNewLabelName('');
  }

  function slotDot(color: LabelDto['color']): React.ReactElement {
    return (
      <span className={cn('size-2 shrink-0 rounded-full', labelSlotClass(color))} aria-hidden />
    );
  }

  function deleteButton(labelId: string): React.ReactElement {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => onDeleteBoardLabel(labelId)}
      >
        {t('deleteLabel')}
      </Button>
    );
  }

  /**
   * The board's palette, drawn flat while it still fits and behind a searchable popover once it
   * does not. `INLINE_PICKER_MAX` is the same number the assignee list reads, so the two never
   * disagree about what counts as a long list. `popoverLatched`, not `shouldUsePopover` directly,
   * is what decides the shape here.
   */
  const palette = popoverLatched ? (
    <SearchablePicker
      triggerLabel={t('addLabelAction', { count: taskLabels.length })}
      searchLabel={t('searchLabels')}
      emptyLabel={t('noMatches')}
      disabled={pending}
      options={boardLabels.map((label) => ({
        id: label.id,
        name: label.name,
        selected: taskLabelIds.has(label.id),
        accent: slotDot(label.color),
        trailing: canManageLabels ? deleteButton(label.id) : undefined,
      }))}
      onToggle={onToggleLabel}
      onOpenChange={setPickerOpen}
    />
  ) : (
    <ul className="flex flex-col gap-1">
      {boardLabels.map((label) => {
        const assigned = taskLabelIds.has(label.id);
        return (
          <li key={label.id} className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-body max-md:min-h-11">
              <input
                type="checkbox"
                checked={assigned}
                disabled={pending}
                onChange={() => onToggleLabel(label.id, assigned)}
              />
              {slotDot(label.color)}
              <span className="truncate">{label.name}</span>
            </label>
            {canManageLabels ? deleteButton(label.id) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-strong text-foreground">{t('labels')}</p>
      <div className="flex flex-wrap gap-1.5">
        {taskLabels.map((label) =>
          canMutate ? (
            <LabelChip
              key={label.id}
              label={label}
              removeLabel={t('removeLabel', { name: label.name })}
              onRemove={() => onToggleLabel(label.id, true)}
            />
          ) : (
            <LabelChip key={label.id} label={label} />
          ),
        )}
        {taskLabels.length === 0 ? (
          <span className="text-small text-muted-foreground">{t('noLabels')}</span>
        ) : null}
      </div>
      {canMutate ? palette : null}
      {canManageLabels ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <Label htmlFor={labelNameId}>{t('newLabel')}</Label>
            <Input
              id={labelNameId}
              value={newLabelName}
              disabled={pending}
              onChange={(event) => setNewLabelName(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn('size-3 shrink-0 rounded-full', labelSlotClass(newLabelColor))}
              aria-hidden
            />
            <Select
              size="sm"
              className="w-auto"
              value={newLabelColor}
              disabled={pending}
              aria-label={t('labelColor')}
              onChange={(event) => setNewLabelColor(event.target.value as LabelColorSlot)}
            >
              {SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {t(`colorValues.${slot}`)}
                </option>
              ))}
            </Select>
          </div>
          {/* Outline, not the default fill: docs/design.md §2 allows one full-strength copper
              action per view beside the rail, and this section action is not the panel's. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void createLabel()}
          >
            {t('createLabel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
