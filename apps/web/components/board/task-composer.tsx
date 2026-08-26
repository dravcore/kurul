'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CreateTaskRequest, TaskDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TaskComposerProps {
  workspaceId: string;
  boardId: string;
  columnId: string;
  onCreated: (task: TaskDto) => void;
  /**
   * Closes the composer. `returnFocus` is false when the field lost focus to something the
   * reader chose themselves: the composer still goes, but pulling focus back out of where they
   * just clicked would undo their own gesture.
   */
  onClose: (returnFocus: boolean) => void;
}

/**
 * The foot-of-column task composer (ADR 0035): a title field where the `Add task` button was.
 *
 * `Enter` creates and stays, `Escape` and an empty blur close, and a typed title is never
 * discarded by a stray click. `Open details` creates the same task and opens its panel, which is
 * where every field this row does not collect already lives.
 */
export function TaskComposer({
  workspaceId,
  boardId,
  columnId,
  onCreated,
  onClose,
}: TaskComposerProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const tTask = useTranslations('app.board.task');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();

  /**
   * Focus on open, and again once a request settles: the field is `disabled` while the create
   * is in flight, which is what takes focus off it in the first place. A failure keeps focus on
   * the alert `SubmitError` moves it to.
   */
  useEffect(() => {
    if (pending || error !== null) return;
    inputRef.current?.focus();
  }, [pending, error]);

  async function create(): Promise<TaskDto | null> {
    if (trimmed.length === 0 || pending) return null;
    setPending(true);
    setError(null);
    try {
      const body: CreateTaskRequest = { title: trimmed, columnId };
      const task = await api.post<TaskDto, CreateTaskRequest>(
        `/workspaces/${workspaceId}/boards/${boardId}/tasks`,
        body,
      );
      onCreated(task);
      setTitle('');
      return task;
    } catch (caught) {
      setError(
        resolveApiMessage(caught, tTask, {
          fallback: 'createError',
          byStatus: { 403: 'forbidden' },
        }),
      );
      return null;
    } finally {
      setPending(false);
    }
  }

  async function openDetails(): Promise<void> {
    const task = await create();
    if (task) router.push(`/board/${boardId}/task/${task.id}`);
  }

  return (
    <form
      data-slot="task-composer"
      aria-busy={pending ? true : undefined}
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Input
        ref={inputRef}
        value={title}
        disabled={pending}
        placeholder={t('composerPlaceholder')}
        aria-label={t('composerPlaceholder')}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // The board's own Escape layer is behind this one, and only the top layer closes.
            event.stopPropagation();
            onClose(true);
            return;
          }
          if (event.key !== 'Enter' || event.shiftKey) return;
          // Implicit submission is not something jsdom performs, so the one key gesture the
          // composer has is dispatched here rather than left to the browser.
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.form?.contains(next)) return;
          if (title.trim().length > 0) return;
          onClose(next === null);
        }}
      />
      {error !== null ? <SubmitError message={error} /> : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        loading={pending}
        disabled={trimmed.length === 0}
        onClick={() => void openDetails()}
      >
        {t('composerOpenDetail')}
      </Button>
    </form>
  );
}
