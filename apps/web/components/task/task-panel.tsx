'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { TaskDto } from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { TaskMetadataPanel } from './task-metadata-panel';

interface TaskPanelProps {
  workspaceId: string;
  boardId: string;
  task: TaskDto | null;
  canMutate: boolean;
  canManageLabels: boolean;
  loadError?: string | null;
  metaRefreshKey?: number;
  onUpdated: (patch: Partial<TaskDto> & Pick<TaskDto, 'id'>) => void;
  onRequestDelete: () => void;
}

export function TaskPanel({
  workspaceId,
  boardId,
  task,
  canMutate,
  canManageLabels,
  loadError = null,
  metaRefreshKey = 0,
  onUpdated,
  onRequestDelete,
}: TaskPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
  }, [task?.id, task?.title, task?.description]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [task?.id]);

  function close(): void {
    router.push(`/board/${boardId}`);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [boardId, router]);

  async function save(): Promise<void> {
    if (!task || !canMutate) return;
    const nextTitle = title.trim();
    if (nextTitle.length === 0) return;
    const nextDescription = description.trim().length > 0 ? description : null;
    if (nextTitle === task.title && nextDescription === task.description) return;

    setPending(true);
    const previousTitle = task.title;
    const previousDescription = task.description;
    onUpdated({ id: task.id, title: nextTitle, description: nextDescription });
    try {
      const updated = await api.patch<TaskDto>(`/workspaces/${workspaceId}/tasks/${task.id}`, {
        title: nextTitle,
        description: nextDescription,
      });
      onUpdated(updated);
    } catch (caught) {
      onUpdated({
        id: task.id,
        title: previousTitle,
        description: previousDescription,
      });
      if (caught instanceof ApiError && caught.statusCode === 403) {
        toast.error(t('forbidden'));
      } else if (caught instanceof ApiError && caught.statusCode === 404) {
        toast.error(t('missing'));
        close();
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
    <aside
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-card',
        'md:w-[min(480px,100%)] md:max-w-[640px] md:min-w-[420px]',
        'fixed inset-0 z-30 md:static md:inset-auto',
      )}
      aria-label={t('panelLabel')}
    >
      <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-title outline-none"
        >
          {task?.title ?? t('panelLabel')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('close')}
          onClick={close}
        >
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {loadError || !task ? (
          <div className="flex flex-col gap-3">
            <p className="text-body text-destructive">{loadError ?? t('missing')}</p>
            <Button type="button" variant="outline" onClick={close}>
              {t('backToBoard')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>{t('title')}</Label>
              <Input
                id={titleId}
                value={title}
                disabled={!canMutate || pending}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void save()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={descriptionId}>{t('description')}</Label>
              <textarea
                id={descriptionId}
                value={description}
                disabled={!canMutate || pending}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => void save()}
                rows={8}
                className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              />
            </div>
            <TaskMetadataPanel
              workspaceId={workspaceId}
              boardId={boardId}
              task={task}
              canMutate={canMutate}
              canManageLabels={canManageLabels}
              metaRefreshKey={metaRefreshKey}
              onUpdated={onUpdated}
            />
            {canMutate ? (
              <div className="mt-auto flex justify-end border-t border-border pt-4">
                <Button type="button" variant="destructive" onClick={onRequestDelete}>
                  {t('deleteAction')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
