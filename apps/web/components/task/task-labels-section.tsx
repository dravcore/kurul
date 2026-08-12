'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LabelColorSlot, type LabelDto } from '@kurultay/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LabelChip, labelSlotClass } from './label-chip';

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

  const taskLabelIds = new Set(taskLabels.map((label) => label.id));

  async function createLabel(): Promise<void> {
    const name = newLabelName.trim();
    if (name.length === 0) return;
    const created = await onCreateLabel(name, newLabelColor);
    if (created) setNewLabelName('');
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-medium text-foreground">{t('labels')}</p>
      <div className="flex flex-wrap gap-1.5">
        {taskLabels.map((label) => (
          <LabelChip
            key={label.id}
            label={label}
            removeLabel={canMutate ? t('removeLabel', { name: label.name }) : undefined}
            onRemove={canMutate ? () => onToggleLabel(label.id, true) : undefined}
          />
        ))}
        {taskLabels.length === 0 ? (
          <span className="text-small text-muted-foreground">{t('noLabels')}</span>
        ) : null}
      </div>
      {canMutate ? (
        <ul className="flex flex-col gap-1">
          {boardLabels.map((label) => {
            const assigned = taskLabelIds.has(label.id);
            return (
              <li key={label.id} className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={assigned}
                    disabled={pending}
                    onChange={() => onToggleLabel(label.id, assigned)}
                  />
                  <span
                    className={cn('size-2 shrink-0 rounded-full', labelSlotClass(label.color))}
                    aria-hidden
                  />
                  <span className="truncate">{label.name}</span>
                </label>
                {canManageLabels ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onDeleteBoardLabel(label.id)}
                  >
                    {t('deleteLabel')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
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
                {slot}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" disabled={pending} onClick={() => void createLabel()}>
            {t('createLabel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
