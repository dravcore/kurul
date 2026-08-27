'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { TaskDto, UpdateTaskRequest } from '@kurul/shared-types';
import { api, apiStatus, resolveApiMessage } from '@/lib/api';
import { SubmitError } from '@/components/common/submit-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface TaskPanelFieldsProps {
  workspaceId: string;
  task: TaskDto;
  canMutate: boolean;
  onUpdated: (patch: Partial<TaskDto> & Pick<TaskDto, 'id'>) => void;
  /** Called when the task turns out to be gone, so the panel does not sit on a dead row. */
  onClose: () => void;
}

/**
 * The task's title and description, and the write behind them.
 *
 * One of the three optimistic write paths named in
 * [ADR 0029](../../../../docs/decisions/0029-client-data-layer.md): the edit is merged into the
 * board's task list before the PATCH is sent, the server's answer is merged over it, and the
 * two remembered fields go back if the write is refused. It lives beside the inputs rather
 * than in the panel shell because the snapshot it rolls back to is exactly what these two
 * fields were showing.
 */
export function TaskPanelFields({
  workspaceId,
  task,
  canMutate,
  onUpdated,
  onClose,
}: TaskPanelFieldsProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);

  // Re-seed the editable fields when the panel switches task, or when the stored title or
  // description changes under it (our own PATCH coming back, or a realtime edit). Done during
  // render rather than from an effect so the panel never paints the previous task's title for
  // one frame first — the flash was visible every time a card was opened from another card.
  const [synced, setSynced] = useState({
    id: task.id,
    title: task.title,
    description: task.description,
  });
  if (
    synced.id !== task.id ||
    synced.title !== task.title ||
    synced.description !== task.description
  ) {
    setSynced({ id: task.id, title: task.title, description: task.description });
    setTitle(task.title);
    setDescription(task.description ?? '');
  }

  async function save(): Promise<void> {
    if (!canMutate) return;
    const nextTitle = title.trim();
    if (nextTitle.length === 0) return;
    const nextDescription = description.trim().length > 0 ? description : null;
    if (nextTitle === task.title && nextDescription === task.description) return;

    setPending(true);
    setConflict(false);
    const previousTitle = task.title;
    const previousDescription = task.description;
    onUpdated({ id: task.id, title: nextTitle, description: nextDescription });
    try {
      const body: UpdateTaskRequest = { title: nextTitle, description: nextDescription };
      const updated = await api.patch<TaskDto, UpdateTaskRequest>(
        `/workspaces/${workspaceId}/tasks/${task.id}`,
        body,
      );
      onUpdated(updated);
    } catch (caught) {
      onUpdated({
        id: task.id,
        title: previousTitle,
        description: previousDescription,
      });
      const status = apiStatus(caught);
      // A conflict is the one failure the reader has to resolve themselves, so it is a line in
      // the panel rather than a toast: a toast asking them to reload would be gone by the time
      // they had read the field it is about.
      if (status === 409) {
        setConflict(true);
        return;
      }
      // A retry only makes sense for a failure the server did not explain; re-sending a
      // rejected write on a 403, or against a task that is gone, just repeats the toast.
      if (status === 403 || status === 404) {
        toast.error(
          resolveApiMessage(caught, t, {
            fallback: 'saveError',
            byStatus: { 403: 'forbidden', 404: 'missing' },
          }),
        );
        if (status === 404) onClose();
      } else {
        toast.error(t('saveError'), {
          action: { label: t('retryAction'), onClick: () => void save() },
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {/*
        No focus move: this panel saves on blur, so the line arrives after the reader has already
        tabbed into the next field. `role="alert"` still announces it.
      */}
      {conflict ? <SubmitError message={t('saveConflict')} focusOnMount={false} /> : null}
      {/* `aria-busy` on the wrapper, not on the field: the mark describes the region being
          written, and a reader standing on the control should not have the control itself
          change state under them (docs/design.md §6). */}
      <div className="flex flex-col gap-1.5" aria-busy={pending || undefined}>
        <Label htmlFor={titleId}>{t('title')}</Label>
        <Input
          id={titleId}
          value={title}
          disabled={!canMutate}
          // `readOnly`, not folded into `disabled`: a disabled field drops focus, and the two
          // fields share one `pending` flag, so a save started from one would otherwise pull
          // focus out from under a reader still typing in the other.
          readOnly={pending}
          className="border-transparent md:text-title-lg focus:border-input"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void save()}
        />
      </div>
      <div className="flex flex-col gap-1.5" aria-busy={pending || undefined}>
        <Label htmlFor={descriptionId}>{t('description')}</Label>
        <Textarea
          id={descriptionId}
          value={description}
          disabled={!canMutate}
          readOnly={pending}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void save()}
          rows={8}
          className="min-h-32 md:text-read"
        />
      </div>
    </>
  );
}
