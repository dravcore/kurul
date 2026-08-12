'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  LabelDto,
  TaskDto,
  UpdateTaskRequest,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { api, apiStatus, resolveApiMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TaskMetadataPanel } from './task-metadata-panel';

interface TaskPanelProps {
  workspaceId: string;
  boardId: string;
  task: TaskDto | null;
  canMutate: boolean;
  canManageLabels: boolean;
  members?: WorkspaceMemberDto[];
  labels?: LabelDto[];
  /**
   * The deep-linked task is still being fetched. Distinct from `task === null`, which on its
   * own cannot tell "not here yet" from "not there at all".
   */
  loading?: boolean;
  /** The fetch failed for a reason that is worth another attempt — never a 404. */
  loadError?: string | null;
  onRetryLoad?: () => void;
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
  members,
  labels,
  loading = false,
  loadError = null,
  onRetryLoad,
  metaRefreshKey = 0,
  onUpdated,
  onRequestDelete,
}: TaskPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const tErrors = useTranslations('app.errors');
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [pending, setPending] = useState(false);

  // Re-seed the editable fields when the panel switches task, or when the stored title or
  // description changes under it (our own PATCH coming back, or a realtime edit). Done during
  // render rather than from an effect so the panel never paints the previous task's title for
  // one frame first — the flash was visible every time a card was opened from another card.
  // The three compared values are exactly what the effect's dependency list was.
  const [synced, setSynced] = useState({
    id: task?.id,
    title: task?.title,
    description: task?.description,
  });
  if (
    synced.id !== task?.id ||
    synced.title !== task?.title ||
    synced.description !== task?.description
  ) {
    setSynced({ id: task?.id, title: task?.title, description: task?.description });
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
  }

  // Closing only takes focus back if the user still has it in here. Tracked from `focusin`
  // rather than read on the way out: by the time the unmount cleanup runs, React has already
  // detached the panel and the browser has already reset `document.activeElement`.
  useEffect(() => {
    function onFocusIn(event: FocusEvent): void {
      const target = event.target;
      focusInsideRef.current =
        target instanceof Node && (panelRef.current?.contains(target) ?? false);
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useEffect(() => {
    // Recorded before focus moves into the panel — nothing else in the tree knows which card
    // opened it. Anything already inside is the panel's own doing (a task loading in
    // underneath it), never a place worth returning to, and `<body>` is the lost-focus state
    // this is here to avoid rather than a target to restore.
    const opener = document.activeElement;
    if (
      opener instanceof HTMLElement &&
      opener !== document.body &&
      !panelRef.current?.contains(opener)
    ) {
      openerRef.current = opener;
    }
    headingRef.current?.focus();
    focusInsideRef.current = panelRef.current?.contains(document.activeElement) ?? false;
  }, [task?.id]);

  // This panel is a plain `<aside>` behind a route segment, not a Radix dialog, so nothing
  // hands focus back when the route drops it: React removes the focused node and the browser
  // resets focus to `<body>`, dumping a keyboard user at the top of the document. Radix
  // `FocusScope` covers the dialogs in `form-dialog.tsx`; here it is done by hand, on unmount.
  useEffect(() => {
    return () => {
      if (!focusInsideRef.current) return;

      const opener = openerRef.current;
      if (opener?.isConnected) {
        opener.focus();
        if (document.activeElement === opener) return;
      }

      // The opener is regularly gone by now — the task was deleted, filtered out of the
      // board, or moved by another client. The board's landmark keeps focus on the page and
      // the tab order roughly where the user was, instead of back at `<body>`. It is not
      // focusable on its own, so it is lent a tabindex for exactly this one focus.
      const main = document.querySelector('main');
      if (!main) return;
      if (!main.hasAttribute('tabindex')) {
        main.setAttribute('tabindex', '-1');
        main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
      }
      main.focus();
    };
  }, []);

  const close = useCallback((): void => {
    // `scroll: false` also opts out of the router's focus pass: Next calls `focus()` on the
    // new route segment after any scroll-applying navigation, which would land on the board
    // wrapper and undo the restoration above. The board is already on screen either way.
    router.push(`/board/${boardId}`, { scroll: false });
  }, [boardId, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

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
      // A retry only makes sense for a failure the server did not explain; re-sending a
      // rejected write on a 403, or against a task that is gone, just repeats the toast.
      if (status === 403 || status === 404) {
        toast.error(
          resolveApiMessage(caught, t, {
            fallback: 'saveError',
            byStatus: { 403: 'forbidden', 404: 'missing' },
          }),
        );
        if (status === 404) close();
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
      ref={panelRef}
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-card',
        'md:w-[min(480px,100%)] md:max-w-[640px] md:min-w-[420px]',
        'fixed inset-0 z-30 md:static md:inset-auto',
      )}
      aria-label={t('panelLabel')}
      aria-busy={loading || undefined}
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
        {/*
          Three answers, not two. A cold deep link (`/board/x/task/y`) opens the panel before
          the board has the row, and folding that into `!task` flashed "This task no longer
          exists" at a task that exists — the one sentence here that must never be a guess.
          Only the third branch is retryable: a 404 is the server being clear, and asking it
          again just repeats itself. `loadError` is `null` for that case by contract.
        */}
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-32 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-24 w-full rounded-[var(--radius-md)]" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col gap-3">
            <p className="text-body text-destructive">{loadError}</p>
            <div className="flex flex-wrap gap-2">
              {onRetryLoad ? (
                <Button type="button" onClick={onRetryLoad}>
                  {tErrors('retry')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={close}>
                {t('backToBoard')}
              </Button>
            </div>
          </div>
        ) : !task ? (
          <div className="flex flex-col gap-3">
            <p className="text-body text-destructive">{t('missing')}</p>
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
              <Textarea
                id={descriptionId}
                value={description}
                disabled={!canMutate || pending}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => void save()}
                rows={8}
                className="min-h-32"
              />
            </div>
            <TaskMetadataPanel
              workspaceId={workspaceId}
              boardId={boardId}
              task={task}
              canMutate={canMutate}
              canManageLabels={canManageLabels}
              members={members}
              labels={labels}
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
