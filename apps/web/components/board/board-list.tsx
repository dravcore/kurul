'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, TrelloImportReportDto, UpdateBoardRequest } from '@kurul/shared-types';
import { canCreateOrUpdateBoard, canDeleteBoard, canMutateColumns } from '@/lib/board-permissions';
import { isAtCeiling, useWorkspacePlan } from '@/lib/plan-query';
import { api, resolveApiMessage } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { InlineRename } from '@/components/common/inline-rename';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateBoardDialog } from './create-board-dialog';
import { DeleteBoardDialog } from './delete-board-dialog';
import { ImportReportPanel } from './import-report-panel';
import { ImportTrelloDialog } from './import-trello-dialog';
import { DamgaMark } from '@/components/brand/damga-mark';

interface BoardCardProps {
  board: BoardDto;
  workspaceId: string;
  canRename: boolean;
  canDelete: boolean;
  onRenamed: (board: BoardDto) => void;
  onDeleteRequested: (board: BoardDto) => void;
}

/**
 * One board tile: the link to the board, and (behind its menu) rename and delete.
 *
 * Rename used to be a dialog (`RenameBoardDialog`); P7 task 6 folds it into this card instead,
 * because the menu item was the only real affordance a dialog gave it. The menu item survives
 * unchanged; what it opens is now an `InlineRename` in place of the name and description, not a
 * modal. Its own component (rather than inline in `BoardList`'s `.map`) because the editing
 * state, the draft fields and the menu trigger ref are all per-board: lifting them into a map
 * keyed by id would be the same state, worse to read.
 */
function BoardCard({
  board,
  workspaceId,
  canRename,
  canDelete,
  onRenamed,
  onDeleteRequested,
}: BoardCardProps): React.ReactElement {
  const t = useTranslations('app.board');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  function startEditing(): void {
    setName(board.name);
    setDescription(board.description ?? '');
    setEditing(true);
  }

  function cancelEditing(): void {
    setName(board.name);
    setDescription(board.description ?? '');
    setEditing(false);
    menuTriggerRef.current?.focus();
  }

  async function saveEditing(): Promise<void> {
    const body: UpdateBoardRequest = { name: name.trim(), description: description.trim() || null };
    const updated = await api.patch<BoardDto, UpdateBoardRequest>(
      `/workspaces/${workspaceId}/boards/${board.id}`,
      body,
    );
    onRenamed(updated);
    setEditing(false);
    menuTriggerRef.current?.focus();
  }

  return (
    <li className="group relative rounded-lg border border-border bg-card p-4 transition-[color,background-color,border-color] hover:border-border-strong hover:bg-accent focus-within:border-border-strong">
      {editing ? (
        <div className="pr-8">
          <InlineRename
            fields={[
              {
                id: `board-name-${board.id}`,
                label: t('name'),
                value: name,
                onChange: setName,
                required: true,
              },
              {
                id: `board-description-${board.id}`,
                label: t('description'),
                value: description,
                onChange: setDescription,
              },
            ]}
            saveLabel={tCommon('save')}
            cancelLabel={t('cancel')}
            onSave={saveEditing}
            onCancel={cancelEditing}
            resolveError={(caught) => resolveApiMessage(caught, t, { fallback: 'renameError' })}
          />
        </div>
      ) : (
        // Never nests the editor above: an `Input` inside this `Link` would be a nested
        // interactive element, and Enter inside it would navigate. Editing swaps this whole
        // branch out instead.
        <Link href={`/board/${board.id}`} className="block pr-8">
          <p className="text-body font-strong text-foreground">{board.name}</p>
          {board.description ? (
            <p className="mt-1 line-clamp-2 text-small text-muted-foreground">
              {board.description}
            </p>
          ) : null}
        </Link>
      )}
      {canRename || canDelete ? (
        <div className="absolute top-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTriggerRef}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('boardMenu')}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Only the rename path needs this hook at all: Escape, a click outside, and the
              // Delete item all close the menu with nothing else claiming focus, so Radix's own
              // default of returning it to this trigger is exactly right and is left alone.
              // Choosing Rename is the one close that already has somewhere better for focus to
              // go: `InlineRename`'s own mount effect focuses its first field, but that effect
              // runs before this menu's focus teardown does (both are triggered by the same
              // click), so it loses the race and is overwritten. `onCloseAutoFocus` is Radix's
              // own designated "we're done tearing down, take over" moment, so doing the
              // focusing here, only when editing, is what actually lands.
              onCloseAutoFocus={(event) => {
                if (!editing) return;
                event.preventDefault();
                const input = document.getElementById(
                  `board-name-${board.id}`,
                ) as HTMLInputElement | null;
                input?.focus();
                input?.select();
              }}
            >
              {canRename ? (
                <DropdownMenuItem onClick={startEditing}>{t('renameAction')}</DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onClick={() => onDeleteRequested(board)}>
                  {t('deleteAction')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  );
}

export function BoardList(): React.ReactElement {
  const t = useTranslations('app.board');
  const tShell = useTranslations('app.shell');
  const tErrors = useTranslations('app.errors');
  const { activeId, activeRole } = useWorkspaceContext();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteBoard, setDeleteBoard] = useState<BoardDto | null>(null);
  // The report lives here rather than inside the dialog: a dialog that stays open to show it
  // would still be one Escape away from destroying the only copy there is (ADR 0025).
  const [importReport, setImportReport] = useState<TrelloImportReportDto | null>(null);

  const canCreate = canCreateOrUpdateBoard(activeRole);
  const canDelete = canDeleteBoard(activeRole);
  const canRename = canCreateOrUpdateBoard(activeRole);
  // The endpoint is admin-only because an import creates columns (ADR 0025). Showing the entry
  // to a MEMBER would be showing a button whose only outcome is a 403 — the same reason every
  // other action on this screen is behind a role check.
  const canImport = canMutateColumns(activeRole);

  // The board ceiling of this workspace, resolved by the API (ADR 0032). `usage.boards` rather
  // than `boards.length`: the two agree, and taking the number from the same document as the
  // ceiling means the pair can never be read from two different moments.
  const plan = useWorkspacePlan(activeId);
  const boardCeiling = plan.limits.boards;
  const atBoardCeiling = isAtCeiling(plan.usage.boards, boardCeiling);
  // One sentence, rendered in two places (the button's title and the line under it) so a
  // pointer and a screen reader are told the same thing.
  const ceilingNotice =
    atBoardCeiling && boardCeiling !== null
      ? t('planLimitReached', { limit: boardCeiling })
      : undefined;

  const fetchBoards = useMemo(
    () => (activeId ? () => fetchWorkspaceBoards(activeId) : null),
    [activeId],
  );
  const {
    data: boards,
    loading,
    error,
    reload,
    setData: setBoards,
  } = useApiResource<BoardDto[]>(fetchBoards, [], t('listError'));

  // No active workspace is a state, not a failure. The shell resolves the roster and, when it
  // is empty, redirects to `/workspaces/new`; until then there is no workspace to scope a
  // request to, so nothing has been asked and nothing has gone wrong. Saying "Could not load
  // boards." here blamed a request that was never made — and left that as the last word on
  // screen for the whole redirect. Same shape as the load below, because it is the same wait.
  // Above the load branches, not inside the settled one. Importing ends in `reload()`, which
  // puts this screen back into `loading` for a moment — and a report that unmounts during that
  // moment is a report the user can never get back, because nothing stores it (ADR 0025).
  const reportPanel =
    importReport === null ? null : (
      <ImportReportPanel report={importReport} onDismiss={() => setImportReport(null)} />
    );

  if (!activeId || loading) {
    return (
      <div className="space-y-6">
        {reportPanel}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy>
          <span className="sr-only">{tShell('loading')}</span>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[88px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    // Nothing here explains itself — a list that did not arrive is the retryable case, so the
    // recovery is a control rather than a sentence (docs/design.md §7).
    return (
      <div className="space-y-6">
        {reportPanel}
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-destructive">{error}</p>
          <Button type="button" onClick={reload}>
            {tErrors('retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {reportPanel}

      <div className="flex items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">{t('listSubtitle')}</p>
        <div className="flex items-center gap-2">
          {canImport ? (
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              {t('import.action')}
            </Button>
          ) : null}
          {canCreate && boards.length > 0 ? (
            // Disabled rather than hidden: the button is the only place the ceiling can be
            // explained, and a control that vanishes reads as a permission problem.
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={atBoardCeiling}
              title={ceilingNotice}
            >
              {t('createAction')}
            </Button>
          ) : null}
        </div>
      </div>

      {canCreate && ceilingNotice !== undefined ? (
        <p className="text-body text-muted-foreground">{ceilingNotice}</p>
      ) : null}

      {boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <DamgaMark />
          <h2 className="font-display text-title-lg font-semibold">{t('emptyTitle')}</h2>
          <p className="max-w-sm text-body text-muted-foreground">{t('emptyBody')}</p>
          {canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)} disabled={atBoardCeiling}>
              {t('createAction')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              workspaceId={activeId}
              canRename={canRename}
              canDelete={canDelete}
              onRenamed={(updated) =>
                setBoards((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                )
              }
              onDeleteRequested={setDeleteBoard}
            />
          ))}
        </ul>
      )}

      <CreateBoardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={activeId}
        onCreated={(board) => setBoards((current) => [...current, board])}
      />
      {canImport ? (
        <ImportTrelloDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          workspaceId={activeId}
          onImported={(report) => {
            setImportReport(report);
            // The report carries an id and a name, not a `BoardDto`. Refetching is the honest
            // way to get the new board into this list; assembling one from two fields would put
            // invented timestamps and a guessed description on screen.
            reload();
          }}
        />
      ) : null}
      <DeleteBoardDialog
        open={deleteBoard !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteBoard(null);
        }}
        workspaceId={activeId}
        board={deleteBoard}
        onDeleted={(boardId) =>
          setBoards((current) => current.filter((item) => item.id !== boardId))
        }
      />
    </div>
  );
}
