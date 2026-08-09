'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  LabelColorSlot,
  Priority,
  type CommentDto,
  type LabelDto,
  type TaskDto,
  type WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LabelChip, labelSlotClass } from './label-chip';
import { PriorityIcon } from './priority-icon';
import { cn } from '@/lib/utils';

const PRIORITIES = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT] as const;
const SLOTS = Object.values(LabelColorSlot);

interface TaskMetadataPanelProps {
  workspaceId: string;
  boardId: string;
  task: TaskDto;
  canMutate: boolean;
  canManageLabels: boolean;
  onUpdated: (task: TaskDto) => void;
}

export function TaskMetadataPanel({
  workspaceId,
  boardId,
  task,
  canMutate,
  canManageLabels,
  onUpdated,
}: TaskMetadataPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const priorityId = useId();
  const dueId = useId();
  const estimateId = useId();
  const commentId = useId();
  const labelNameId = useId();

  const [members, setMembers] = useState<WorkspaceMemberDto[]>([]);
  const [boardLabels, setBoardLabels] = useState<LabelDto[]>([]);
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [estimateDraft, setEstimateDraft] = useState(
    task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '',
  );
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<LabelColorSlot>(LabelColorSlot['slot-1']);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setEstimateDraft(task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '');
  }, [task.id, task.estimatedMinutes]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [nextMembers, nextLabels, nextComments] = await Promise.all([
          api.get<WorkspaceMemberDto[]>(`/workspaces/${workspaceId}/members`, {
            signal: controller.signal,
          }),
          api.get<LabelDto[]>(`/workspaces/${workspaceId}/boards/${boardId}/labels`, {
            signal: controller.signal,
          }),
          api.get<CommentDto[]>(`/workspaces/${workspaceId}/tasks/${task.id}/comments`, {
            signal: controller.signal,
          }),
        ]);
        if (!controller.signal.aborted) {
          setMembers(nextMembers);
          setBoardLabels(nextLabels);
          setComments(nextComments);
        }
      } catch {
        if (!controller.signal.aborted) {
          toast.error(t('metaLoadError'));
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceId, boardId, task.id, t]);

  async function patchTask(body: Record<string, unknown>): Promise<void> {
    setPending(true);
    const previous = task;
    try {
      const updated = await api.patch<TaskDto>(`/workspaces/${workspaceId}/tasks/${task.id}`, body);
      onUpdated(updated);
    } catch (caught) {
      onUpdated(previous);
      toastMetaError(caught);
    } finally {
      setPending(false);
    }
  }

  function toastMetaError(caught: unknown): void {
    if (caught instanceof ApiError && caught.statusCode === 403) {
      toast.error(t('forbidden'));
    } else {
      toast.error(t('saveError'));
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
        : await api.post<TaskDto>(`/workspaces/${workspaceId}/tasks/${task.id}/assignees`, {
            userId,
          });
      onUpdated(updated);
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
        : await api.post<TaskDto>(`/workspaces/${workspaceId}/tasks/${task.id}/labels`, {
            labelId,
          });
      onUpdated(updated);
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPending(false);
    }
  }

  async function createLabel(): Promise<void> {
    if (!canManageLabels) return;
    const name = newLabelName.trim();
    if (name.length === 0) return;
    setPending(true);
    try {
      const created = await api.post<LabelDto>(
        `/workspaces/${workspaceId}/boards/${boardId}/labels`,
        { name, color: newLabelColor },
      );
      setBoardLabels((current) =>
        [...current, created].sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      );
      setNewLabelName('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        toast.error(t('labelForbidden'));
      } else {
        toast.error(t('labelSaveError'));
      }
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
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        toast.error(t('labelForbidden'));
      } else {
        toast.error(t('labelSaveError'));
      }
    } finally {
      setPending(false);
    }
  }

  async function submitComment(): Promise<void> {
    if (!canMutate) return;
    const body = commentBody.trim();
    if (body.length === 0) return;
    setPending(true);
    try {
      const created = await api.post<CommentDto>(
        `/workspaces/${workspaceId}/tasks/${task.id}/comments`,
        { body },
      );
      setComments((current) => [...current, created]);
      setCommentBody('');
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPending(false);
    }
  }

  async function removeComment(commentIdValue: string): Promise<void> {
    if (!canMutate) return;
    setPending(true);
    try {
      await api.delete(`/workspaces/${workspaceId}/comments/${commentIdValue}`);
      setComments((current) => current.filter((comment) => comment.id !== commentIdValue));
    } catch (caught) {
      toastMetaError(caught);
    } finally {
      setPending(false);
    }
  }

  const assignedIds = new Set(task.assignees.map((assignee) => assignee.userId));
  const taskLabelIds = new Set(task.labels.map((label) => label.id));
  const dueValue = task.dueDate ? task.dueDate.slice(0, 10) : '';

  return (
    <div className="flex flex-col gap-5 border-t border-border pt-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={priorityId}>{t('priority')}</Label>
        <div className="flex items-center gap-2">
          <PriorityIcon priority={task.priority} title={t(`priorityValues.${task.priority}`)} />
          <select
            id={priorityId}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            value={task.priority}
            disabled={!canMutate || pending}
            onChange={(event) => void patchTask({ priority: event.target.value })}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`priorityValues.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={dueId}>{t('dueDate')}</Label>
          <Input
            id={dueId}
            type="date"
            value={dueValue}
            disabled={!canMutate || pending}
            onChange={(event) => {
              const value = event.target.value;
              void patchTask({
                dueDate: value.length > 0 ? `${value}T12:00:00.000Z` : null,
              });
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
            disabled={!canMutate || pending}
            placeholder={t('estimatePlaceholder')}
            onChange={(event) => setEstimateDraft(event.target.value)}
            onBlur={() => {
              const raw = estimateDraft.trim();
              const next = raw.length > 0 ? Number.parseInt(raw, 10) : null;
              if (next === null) {
                if (task.estimatedMinutes === null) return;
                void patchTask({ estimatedMinutes: null });
                return;
              }
              if (Number.isNaN(next)) {
                setEstimateDraft(
                  task.estimatedMinutes !== null ? String(task.estimatedMinutes) : '',
                );
                return;
              }
              if (next === task.estimatedMinutes) return;
              void patchTask({ estimatedMinutes: next });
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-small font-medium text-foreground">{t('assignees')}</p>
        <ul className="flex flex-col gap-1">
          {members.map((member) => {
            const assigned = assignedIds.has(member.userId);
            return (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={assigned}
                    disabled={!canMutate || pending}
                    onChange={() => void toggleAssignee(member.userId, assigned)}
                  />
                  <span>{member.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-small font-medium text-foreground">{t('labels')}</p>
        <div className="flex flex-wrap gap-1.5">
          {task.labels.map((label) => (
            <LabelChip
              key={label.id}
              label={label}
              removeLabel={canMutate ? t('removeLabel', { name: label.name }) : undefined}
              onRemove={canMutate ? () => void toggleLabel(label.id, true) : undefined}
            />
          ))}
          {task.labels.length === 0 ? (
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
                      onChange={() => void toggleLabel(label.id, assigned)}
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
                      onClick={() => void deleteBoardLabel(label.id)}
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
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-body"
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
            </select>
            <Button type="button" size="sm" disabled={pending} onClick={() => void createLabel()}>
              {t('createLabel')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-small font-medium text-foreground">{t('comments')}</p>
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-small font-medium text-foreground">{comment.author.name}</p>
                  <p className="text-micro text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleString()}
                  </p>
                </div>
                {canMutate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void removeComment(comment.id)}
                  >
                    {t('deleteComment')}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-body text-foreground">{comment.body}</p>
            </li>
          ))}
          {comments.length === 0 ? (
            <li className="text-small text-muted-foreground">{t('noComments')}</li>
          ) : null}
        </ul>
        {canMutate ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={commentId}>{t('addComment')}</Label>
            <textarea
              id={commentId}
              value={commentBody}
              disabled={pending}
              rows={3}
              onChange={(event) => setCommentBody(event.target.value)}
              className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => void submitComment()}
              >
                {t('postComment')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
