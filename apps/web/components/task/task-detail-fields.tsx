'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Priority, type TaskDto, type UpdateTaskRequest } from '@kurul/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PriorityIcon } from './priority-icon';

const PRIORITIES = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT] as const;

interface TaskDetailFieldsProps {
  task: TaskDto;
  /** The reader may not write at all. A permission lock, never a request in flight. */
  disabled: boolean;
  /** The `UpdateTaskRequest` keys whose own PATCH has not come back yet. */
  pendingFields: ReadonlySet<keyof UpdateTaskRequest>;
  onPatch: (body: UpdateTaskRequest) => void;
}

/**
 * Priority, due date and estimate. The estimate is a draft until blur — a half-typed number
 * must not fire a request per keystroke — while the other two save on change.
 *
 * A field with its own write out goes `readOnly` and refuses the change; it never goes
 * `disabled`, which is what a browser blurs (docs/design.md §6). The three are gated one at a
 * time, so saving the priority leaves the estimate the reader is typing in alone.
 */
export function TaskDetailFields({
  task,
  disabled,
  pendingFields,
  onPatch,
}: TaskDetailFieldsProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const priorityId = useId();
  const dueId = useId();
  const estimateId = useId();
  const [estimateDraft, setEstimateDraft] = useState(
    task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '',
  );

  // Re-seed the draft when the panel switches task, or when the saved estimate changes under
  // it (our own PATCH coming back, or a realtime edit). Done during render rather than from
  // an effect so the field never paints the previous task's estimate for one frame first.
  // The pair is exactly what the effect's dependency list was.
  const [synced, setSynced] = useState({ id: task.id, estimate: task.estimatedMinutes });
  if (synced.id !== task.id || synced.estimate !== task.estimatedMinutes) {
    setSynced({ id: task.id, estimate: task.estimatedMinutes });
    setEstimateDraft(task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '');
  }

  const dueValue = task.dueDate ? task.dueDate.slice(0, 10) : '';

  const prioritySaving = pendingFields.has('priority');
  const dueSaving = pendingFields.has('dueDate');
  const estimateSaving = pendingFields.has('estimatedMinutes');

  function commitEstimate(): void {
    if (estimateSaving) return;
    const raw = estimateDraft.trim();
    const next = raw.length > 0 ? Number.parseInt(raw, 10) : null;
    if (next === null) {
      if (task.estimatedMinutes === null) return;
      onPatch({ estimatedMinutes: null });
      return;
    }
    if (Number.isNaN(next)) {
      setEstimateDraft(task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '');
      return;
    }
    if (next === task.estimatedMinutes) return;
    onPatch({ estimatedMinutes: next });
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={priorityId}>{t('priority')}</Label>
        <div className="flex items-center gap-2">
          <PriorityIcon priority={task.priority} title={t(`priorityValues.${task.priority}`)} />
          <Select
            id={priorityId}
            size="sm"
            value={task.priority}
            disabled={disabled}
            // A native `<select>` has no `readOnly`, so it stays enabled and the handler is
            // what refuses. React puts the shown value back, so a refused choice is never left
            // on screen as one that saved.
            aria-disabled={prioritySaving || undefined}
            onChange={(event) => {
              if (prioritySaving) return;
              onPatch({ priority: event.target.value as Priority });
            }}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`priorityValues.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={dueId}>{t('dueDate')}</Label>
          <Input
            id={dueId}
            type="date"
            value={dueValue}
            disabled={disabled}
            readOnly={dueSaving}
            onChange={(event) => {
              if (dueSaving) return;
              const value = event.target.value;
              onPatch({ dueDate: value.length > 0 ? `${value}T12:00:00.000Z` : null });
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={estimateId}>{t('estimate')}</Label>
          <Input
            id={estimateId}
            type="number"
            min={0}
            step={15}
            value={estimateDraft}
            disabled={disabled}
            readOnly={estimateSaving}
            placeholder={t('estimatePlaceholder')}
            onChange={(event) => {
              if (estimateSaving) return;
              setEstimateDraft(event.target.value);
            }}
            onBlur={commitEstimate}
          />
        </div>
      </div>
    </>
  );
}
