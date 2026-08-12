'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Priority, type TaskDto, type UpdateTaskRequest } from '@kurultay/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PriorityIcon } from './priority-icon';

const PRIORITIES = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT] as const;

interface TaskDetailFieldsProps {
  task: TaskDto;
  disabled: boolean;
  onPatch: (body: UpdateTaskRequest) => void;
}

/**
 * Priority, due date and estimate. The estimate is a draft until blur — a half-typed number
 * must not fire a request per keystroke — while the other two save on change.
 */
export function TaskDetailFields({
  task,
  disabled,
  onPatch,
}: TaskDetailFieldsProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const priorityId = useId();
  const dueId = useId();
  const estimateId = useId();
  const [estimateDraft, setEstimateDraft] = useState(
    task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '',
  );

  useEffect(() => {
    setEstimateDraft(task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '');
  }, [task.id, task.estimatedMinutes]);

  const dueValue = task.dueDate ? task.dueDate.slice(0, 10) : '';

  function commitEstimate(): void {
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
            onChange={(event) => onPatch({ priority: event.target.value as Priority })}
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
            onChange={(event) => {
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
            placeholder={t('estimatePlaceholder')}
            onChange={(event) => setEstimateDraft(event.target.value)}
            onBlur={commitEstimate}
          />
        </div>
      </div>
    </>
  );
}
