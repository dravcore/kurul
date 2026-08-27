'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  AddAssigneeRequest,
  AddTaskLabelRequest,
  CreateLabelRequest,
  LabelColorSlot,
  LabelDto,
  TaskDto,
  UpdateTaskRequest,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { TaskAssigneesSection } from './task-assignees-section';
import { TaskDetailFields } from './task-detail-fields';
import { TaskLabelsSection } from './task-labels-section';
import type { UseTaskMetadataResult } from './use-task-metadata';

interface TaskPropertiesPanelProps {
  workspaceId: string;
  boardId: string;
  task: TaskDto;
  canMutate: boolean;
  canManageLabels: boolean;
  /**
   * The one read `TaskPanel` runs for this section and the discussion below it. Held by the
   * panel rather than by either half, so that splitting them stayed a layout change and did
   * not turn one round of requests into two.
   */
  meta: UseTaskMetadataResult;
  onUpdated: (patch: Partial<TaskDto> & Pick<TaskDto, 'id'>) => void;
}

/**
 * Adds or removes ids, answering a new set: pending state is read as a value, never mutated.
 */
function withIds<T>(current: ReadonlySet<T>, ids: readonly T[], present: boolean): ReadonlySet<T> {
  const next = new Set(current);
  for (const id of ids) {
    if (present) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * What the task *is*: priority, due date, estimate, who is on it and how it is labelled.
 *
 * This module owns those writes and sits directly under the title and description, above the
 * checklists, so the panel reads in the same order as the card it was opened from.
 *
 * Pending state is scoped to the control actually in flight, never shared across the section
 * (docs/design.md §6). One shared flag meant that toggling a label re-rendered the priority
 * select, the two fields and every other row as `disabled`, and a browser blurs a disabled
 * control: the reader lost their caret to `<body>` on every edit. What says a write is
 * happening is the live region below, not the control the reader is standing on.
 */
export function TaskPropertiesPanel({
  workspaceId,
  boardId,
  task,
  canMutate,
  canManageLabels,
  meta,
  onUpdated,
}: TaskPropertiesPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const [pendingFields, setPendingFields] = useState<ReadonlySet<keyof UpdateTaskRequest>>(
    new Set(),
  );
  const [pendingUserIds, setPendingUserIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingLabelIds, setPendingLabelIds] = useState<ReadonlySet<string>>(new Set());
  const [creatingLabel, setCreatingLabel] = useState(false);

  const busy =
    pendingFields.size > 0 || pendingUserIds.size > 0 || pendingLabelIds.size > 0 || creatingLabel;

  const { members, boardLabels, setBoardLabels, refreshActivities } = meta;

  function toastMetaError(caught: unknown): void {
    toast.error(
      resolveApiMessage(caught, t, { fallback: 'saveError', byStatus: { 403: 'forbidden' } }),
    );
  }

  function toastLabelError(caught: unknown): void {
    toast.error(
      resolveApiMessage(caught, t, {
        fallback: 'labelSaveError',
        byStatus: { 403: 'labelForbidden' },
      }),
    );
  }

  async function patchTask(body: UpdateTaskRequest): Promise<void> {
    const fields = Object.keys(body) as Array<keyof UpdateTaskRequest>;
    setPendingFields((current) => withIds(current, fields, true));
    const previous = task;
    try {
      const updated = await api.patch<TaskDto, UpdateTaskRequest>(
        `/workspaces/${workspaceId}/tasks/${task.id}`,
        body,
      );
      onUpdated(updated);
    } catch (caught) {
      const restore: Partial<TaskDto> & Pick<TaskDto, 'id'> = { id: previous.id };
      for (const key of Object.keys(body) as Array<keyof TaskDto>) {
        if (key === 'id') continue;
        if (key in previous) {
          (restore as Record<string, unknown>)[key] = previous[key];
        }
      }
      onUpdated(restore);
      toastMetaError(caught);
    } finally {
      setPendingFields((current) => withIds(current, fields, false));
    }
  }

  async function toggleAssignee(userId: string, assigned: boolean): Promise<void> {
    if (!canMutate) return;
    setPendingUserIds((current) => withIds(current, [userId], true));
    try {
      const updated = assigned
        ? await api.delete<TaskDto>(
            `/workspaces/${workspaceId}/tasks/${task.id}/assignees/${userId}`,
          )
        : await api.post<TaskDto, AddAssigneeRequest>(
            `/workspaces/${workspaceId}/tasks/${task.id}/assignees`,
            { userId },
          );
      onUpdated(updated);
      // The history this writes is rendered by the discussion panel, further down the same
      // scroll column, so the refresh has to reach the shared read rather than local state.
      await refreshActivities();
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPendingUserIds((current) => withIds(current, [userId], false));
    }
  }

  async function toggleLabel(labelId: string, assigned: boolean): Promise<void> {
    if (!canMutate) return;
    setPendingLabelIds((current) => withIds(current, [labelId], true));
    try {
      const updated = assigned
        ? await api.delete<TaskDto>(`/workspaces/${workspaceId}/tasks/${task.id}/labels/${labelId}`)
        : await api.post<TaskDto, AddTaskLabelRequest>(
            `/workspaces/${workspaceId}/tasks/${task.id}/labels`,
            { labelId },
          );
      onUpdated(updated);
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPendingLabelIds((current) => withIds(current, [labelId], false));
    }
  }

  async function createLabel(name: string, color: LabelColorSlot): Promise<boolean> {
    if (!canManageLabels) return false;
    setCreatingLabel(true);
    try {
      const body: CreateLabelRequest = { name, color };
      const created = await api.post<LabelDto, CreateLabelRequest>(
        `/workspaces/${workspaceId}/boards/${boardId}/labels`,
        body,
      );
      setBoardLabels((current) =>
        [...current, created].sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      );
      return true;
    } catch (caught) {
      toastLabelError(caught);
      return false;
    } finally {
      setCreatingLabel(false);
    }
  }

  async function deleteBoardLabel(labelId: string): Promise<void> {
    if (!canManageLabels) return;
    setPendingLabelIds((current) => withIds(current, [labelId], true));
    try {
      await api.delete(`/workspaces/${workspaceId}/labels/${labelId}`);
      setBoardLabels((current) => current.filter((label) => label.id !== labelId));
      onUpdated({
        ...task,
        labels: task.labels.filter((label) => label.id !== labelId),
      });
      // What the screen shows is one palette row and this task's chip going away. What actually
      // happened is that the label left every task on the board, so the confirmation has to say
      // so: the visible change under-reports the blast radius.
      toast.success(t('labelDeleted'));
    } catch (caught) {
      toast.error(
        resolveApiMessage(caught, t, {
          fallback: 'labelDeleteError',
          byStatus: { 403: 'labelForbidden' },
        }),
      );
    } finally {
      setPendingLabelIds((current) => withIds(current, [labelId], false));
    }
  }

  const assignedUserIds = new Set(task.assignees.map((assignee) => assignee.userId));

  return (
    <section
      aria-label={t('propertiesTitle')}
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <p className="text-small font-strong text-foreground">{t('propertiesTitle')}</p>

      {/* Mounted whether or not anything is in flight: a `role="status"` inserted at the same
          moment as its own text is announced unevenly across screen readers, and with no
          control going disabled this region is the only thing that says a write is out. */}
      <p role="status" aria-busy={busy || undefined} className="sr-only">
        {busy ? t('saving') : ''}
      </p>

      <div className="flex flex-col gap-5">
        <TaskDetailFields
          task={task}
          disabled={!canMutate}
          pendingFields={pendingFields}
          onPatch={(body) => void patchTask(body)}
        />

        <TaskAssigneesSection
          members={members}
          assignedUserIds={assignedUserIds}
          disabled={!canMutate}
          pendingUserIds={pendingUserIds}
          onToggle={(userId, assigned) => void toggleAssignee(userId, assigned)}
        />

        <TaskLabelsSection
          taskLabels={task.labels}
          boardLabels={boardLabels}
          canMutate={canMutate}
          canManageLabels={canManageLabels}
          pendingLabelIds={pendingLabelIds}
          creatingLabel={creatingLabel}
          onToggleLabel={(labelId, assigned) => void toggleLabel(labelId, assigned)}
          onDeleteBoardLabel={(labelId) => void deleteBoardLabel(labelId)}
          onCreateLabel={createLabel}
        />
      </div>
    </section>
  );
}
