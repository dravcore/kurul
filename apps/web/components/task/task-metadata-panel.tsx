'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  AddAssigneeRequest,
  AddTaskLabelRequest,
  CommentDto,
  CreateCommentRequest,
  CreateLabelRequest,
  LabelColorSlot,
  LabelDto,
  TaskDto,
  UpdateTaskRequest,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { TaskActivitySection } from './task-activity-section';
import { TaskAssigneesSection } from './task-assignees-section';
import { TaskCommentsSection } from './task-comments-section';
import { TaskDetailFields } from './task-detail-fields';
import { TaskLabelsSection } from './task-labels-section';
import { useTaskMetadata } from './use-task-metadata';

interface TaskMetadataPanelProps {
  workspaceId: string;
  boardId: string;
  task: TaskDto;
  canMutate: boolean;
  canManageLabels: boolean;
  /** Board-scoped caches from BoardView — skip refetch when provided. */
  members?: WorkspaceMemberDto[];
  labels?: LabelDto[];
  /** Bump to refetch comments/activity without remounting. */
  metaRefreshKey?: number;
  onUpdated: (patch: Partial<TaskDto> & Pick<TaskDto, 'id'>) => void;
}

/**
 * Everything below the task title and description. This module owns the writes — one
 * `pending` flag disables the whole panel while any of them is in flight — and each section
 * below renders one slice of the task.
 */
export function TaskMetadataPanel({
  workspaceId,
  boardId,
  task,
  canMutate,
  canManageLabels,
  members: membersProp,
  labels: labelsProp,
  metaRefreshKey = 0,
  onUpdated,
}: TaskMetadataPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const [pending, setPending] = useState(false);

  const {
    members,
    boardLabels,
    setBoardLabels,
    comments,
    setComments,
    hasMoreComments,
    loadingMoreComments,
    loadMoreComments,
    activities,
    refreshActivities,
    loadingMeta,
    metaFailed,
  } = useTaskMetadata({
    workspaceId,
    boardId,
    taskId: task.id,
    members: membersProp,
    labels: labelsProp,
    metaRefreshKey,
  });

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

  /**
   * Names the object the caller actually touched, rather than the task it hangs off.
   *
   * Comment writes used to fall through to `saveError` — "Could not save this task." — which
   * describes a write the user did not make and leaves the comment they did make unexplained.
   */
  function toastObjectError(caught: unknown, fallback: string): void {
    toast.error(resolveApiMessage(caught, t, { fallback, byStatus: { 403: 'forbidden' } }));
  }

  async function patchTask(body: UpdateTaskRequest): Promise<void> {
    setPending(true);
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
      setPending(false);
    }
  }

  async function toggleAssignee(userId: string, assigned: boolean): Promise<void> {
    if (!canMutate) return;
    setPending(true);
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
      await refreshActivities();
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPending(false);
    }
  }

  async function toggleLabel(labelId: string, assigned: boolean): Promise<void> {
    if (!canMutate) return;
    setPending(true);
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
      setPending(false);
    }
  }

  async function createLabel(name: string, color: LabelColorSlot): Promise<boolean> {
    if (!canManageLabels) return false;
    setPending(true);
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
      setPending(false);
    }
  }

  async function deleteBoardLabel(labelId: string): Promise<void> {
    if (!canManageLabels) return;
    setPending(true);
    try {
      await api.delete(`/workspaces/${workspaceId}/labels/${labelId}`);
      setBoardLabels((current) => current.filter((label) => label.id !== labelId));
      onUpdated({
        ...task,
        labels: task.labels.filter((label) => label.id !== labelId),
      });
      // What the screen shows is one palette row and this task's chip going away. What actually
      // happened is that the label left every task on the board, so the confirmation has to say
      // so — the visible change under-reports the blast radius.
      toast.success(t('labelDeleted'));
    } catch (caught) {
      toast.error(
        resolveApiMessage(caught, t, {
          fallback: 'labelDeleteError',
          byStatus: { 403: 'labelForbidden' },
        }),
      );
    } finally {
      setPending(false);
    }
  }

  async function submitComment(body: string): Promise<boolean> {
    if (!canMutate) return false;
    setPending(true);
    try {
      const payload: CreateCommentRequest = { body };
      const created = await api.post<CommentDto, CreateCommentRequest>(
        `/workspaces/${workspaceId}/tasks/${task.id}/comments`,
        payload,
      );
      setComments((current) => [...current, created]);
      await refreshActivities();
      return true;
    } catch (caught) {
      toastObjectError(caught, 'commentError');
      return false;
    } finally {
      setPending(false);
    }
  }

  async function removeComment(commentId: string): Promise<void> {
    if (!canMutate) return;
    setPending(true);
    try {
      await api.delete(`/workspaces/${workspaceId}/comments/${commentId}`);
      setComments((current) => current.filter((comment) => comment.id !== commentId));
    } catch (caught) {
      toastObjectError(caught, 'commentDeleteError');
    } finally {
      setPending(false);
    }
  }

  const assignedUserIds = new Set(task.assignees.map((assignee) => assignee.userId));

  return (
    <div className="flex flex-col gap-5 border-t border-border pt-4">
      <TaskDetailFields
        task={task}
        disabled={!canMutate || pending}
        onPatch={(body) => void patchTask(body)}
      />

      <TaskAssigneesSection
        members={members}
        assignedUserIds={assignedUserIds}
        disabled={!canMutate || pending}
        onToggle={(userId, assigned) => void toggleAssignee(userId, assigned)}
      />

      <TaskLabelsSection
        taskLabels={task.labels}
        boardLabels={boardLabels}
        canMutate={canMutate}
        canManageLabels={canManageLabels}
        pending={pending}
        onToggleLabel={(labelId, assigned) => void toggleLabel(labelId, assigned)}
        onDeleteBoardLabel={(labelId) => void deleteBoardLabel(labelId)}
        onCreateLabel={createLabel}
      />

      <TaskCommentsSection
        comments={comments}
        members={members}
        canMutate={canMutate}
        pending={pending}
        loading={loadingMeta}
        loadFailed={metaFailed}
        hasMore={hasMoreComments}
        loadingMore={loadingMoreComments}
        onLoadMore={() => void loadMoreComments()}
        onSubmit={submitComment}
        onDelete={(commentId) => void removeComment(commentId)}
      />

      <TaskActivitySection activities={activities} loading={loadingMeta} loadFailed={metaFailed} />
    </div>
  );
}
