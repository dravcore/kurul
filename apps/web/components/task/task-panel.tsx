'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LabelDto, TaskDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TaskAttachments } from './task-attachments';
import { TaskChecklists } from './task-checklists';
import { TaskDiscussionPanel } from './task-discussion-panel';
import { TaskPanelFields } from './task-panel-fields';
import { TaskPanelStatus } from './task-panel-status';
import { TaskPropertiesPanel } from './task-properties-panel';
import { useTaskAttachments } from './use-task-attachments';
import { useTaskChecklists } from './use-task-checklists';
import { useTaskMetadata } from './use-task-metadata';
import { useTaskPanelFocus } from './use-task-panel-focus';

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

/**
 * The panel shell: the route-backed `<aside>`, its header, and the sections it composes.
 *
 * Everything with a life of its own has been factored out around it: the focus and dismiss
 * behaviour into `useTaskPanelFocus`, the title/description write into `TaskPanelFields`, the
 * no-task states into `TaskPanelStatus`, and each remaining section into its own component
 * and hook. What is left here is the layout and the wiring between them.
 */
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
  const router = useRouter();

  const close = useCallback((): void => {
    // `scroll: false` also opts out of the router's focus pass: Next calls `focus()` on the
    // new route segment after any scroll-applying navigation, which would land on the board
    // wrapper and undo the focus restoration in `useTaskPanelFocus`. The board is already on
    // screen either way.
    router.push(`/board/${boardId}`, { scroll: false });
  }, [boardId, router]);

  const { panelRef, headingRef } = useTaskPanelFocus({ taskId: task?.id, onClose: close });

  // Its own hook rather than more handlers in this component: the task a board row hands over
  // carries `checklists: null` — the summary only — so the checklist surface owns a read as
  // well as five writes.
  const checklists = useTaskChecklists({ workspaceId, task, canMutate, onUpdated });

  // Attachments do not ride on the task DTO the way checklists do — `TaskDto` carries only
  // `attachmentCount` (decision D2), so this hook owns a list of its own. The count is written
  // back through the same `onUpdated` merge every other write uses, which is what keeps the
  // board card's badge in step without waiting for this tab's own `task:updated` broadcast.
  const onAttachmentCountChanged = useCallback(
    (id: string, attachmentCount: number) => onUpdated({ id, attachmentCount }),
    [onUpdated],
  );
  const attachments = useTaskAttachments({
    workspaceId,
    task,
    canMutate,
    onCountChanged: onAttachmentCountChanged,
  });

  // Read here rather than inside either section that renders it: the properties section and the
  // discussion section are separated by the checklists and the attachments, and they share one
  // fetch. Held by the panel is what keeps that one round of requests one round.
  const meta = useTaskMetadata({
    workspaceId,
    boardId,
    taskId: task?.id ?? null,
    members,
    labels,
    metaRefreshKey,
  });

  return (
    <aside
      ref={panelRef}
      // Read by `components/board/use-create-task-shortcut.ts`: below `md` this panel covers the
      // board, so a `c` typed inside it must not open a composer behind it.
      data-slot="task-panel"
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-card',
        'md:w-[min(480px,100%)] md:max-w-[640px] md:min-w-[420px]',
        'fixed inset-0 z-30 md:static md:inset-auto',
      )}
      aria-label={t('panelLabel')}
      aria-busy={loading || undefined}
    >
      <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        {/* `use-task-panel-focus.ts` focuses this heading on every panel open, which a keyboard
            user reaches by pressing Enter on a task card, and the element matches
            `:focus-visible` after it. So it draws the one focus mark app/globals.css sets in
            `@layer base`; an `outline-*` suppressor here is the only thing that can erase it.
            The 2px offset fits inside the 48px header without meeting its bottom border. */}
        <h2 ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-title">
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
        {loading || loadError || !task ? (
          <TaskPanelStatus
            loading={loading}
            loadError={loadError}
            onRetryLoad={onRetryLoad}
            onClose={close}
          />
        ) : (
          <>
            <TaskPanelFields
              workspaceId={workspaceId}
              task={task}
              canMutate={canMutate}
              onUpdated={onUpdated}
              onClose={close}
            />
            {/*
              Properties before the content, the same order the card itself reads in: what the
              task is, then what is in it, then what was said about it.
            */}
            <TaskPropertiesPanel
              workspaceId={workspaceId}
              boardId={boardId}
              task={task}
              canMutate={canMutate}
              canManageLabels={canManageLabels}
              meta={meta}
              onUpdated={onUpdated}
            />
            <TaskChecklists
              checklists={checklists.checklists}
              canMutate={canMutate}
              pending={checklists.pending}
              loading={checklists.loading}
              loadFailed={checklists.loadFailed}
              onToggle={(itemId, isDone) => void checklists.toggleItem(itemId, isDone)}
              onAddChecklist={checklists.addChecklist}
              onRemoveChecklist={(checklistId) => void checklists.removeChecklist(checklistId)}
              onAddItem={checklists.addItem}
              onRemoveItem={(itemId) => void checklists.removeItem(itemId)}
            />
            <TaskAttachments
              workspaceId={workspaceId}
              attachments={attachments.attachments}
              canMutate={canMutate}
              storageEnabled={attachments.storageEnabled}
              pending={attachments.pending}
              loading={attachments.loading}
              loadFailed={attachments.loadFailed}
              onUpload={attachments.upload}
              onAddLink={attachments.addLink}
              onRemove={(attachmentId) => void attachments.remove(attachmentId)}
            />
            {/*
              The last section, and nothing may be appended after it: the delete footer below is
              `mt-auto` and only reaches the bottom of the panel while it is the last child of
              this flex column.
            */}
            <TaskDiscussionPanel
              workspaceId={workspaceId}
              task={task}
              canMutate={canMutate}
              meta={meta}
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
