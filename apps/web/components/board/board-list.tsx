'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto } from '@kurultay/shared-types';
import { canCreateOrUpdateBoard, canDeleteBoard } from '@/lib/board-permissions';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
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
import { RenameBoardDialog } from './rename-board-dialog';
import { DamgaMark } from '@/components/brand/damga-mark';

export function BoardList(): React.ReactElement {
  const t = useTranslations('app.board');
  const { activeId, activeRole } = useWorkspaceContext();
  const [boards, setBoards] = useState<BoardDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameBoard, setRenameBoard] = useState<BoardDto | null>(null);
  const [deleteBoard, setDeleteBoard] = useState<BoardDto | null>(null);

  const canCreate = canCreateOrUpdateBoard(activeRole);
  const canDelete = canDeleteBoard(activeRole);
  const canRename = canCreateOrUpdateBoard(activeRole);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await fetchWorkspaceBoards(activeId, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setBoards(list);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(t('listError'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [activeId, t]);

  if (!activeId) {
    return <p className="text-body text-muted-foreground">{t('listError')}</p>;
  }

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[88px] w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-body text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">{t('listSubtitle')}</p>
        {canCreate ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('createAction')}
          </Button>
        ) : null}
      </div>

      {boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <DamgaMark />
          <h2 className="font-display text-title-lg font-semibold">{t('emptyTitle')}</h2>
          <p className="max-w-sm text-body text-muted-foreground">{t('emptyBody')}</p>
          {canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('createAction')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li
              key={board.id}
              className="group relative rounded-[var(--radius-lg)] border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/40 focus-within:border-border-strong"
            >
              <Link href={`/board/${board.id}`} className="block pr-8">
                <p className="text-body font-strong text-foreground">{board.name}</p>
                {board.description ? (
                  <p className="mt-1 line-clamp-2 text-small text-muted-foreground">
                    {board.description}
                  </p>
                ) : null}
              </Link>
              {canRename || canDelete ? (
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('boardMenu')}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canRename ? (
                        <DropdownMenuItem onClick={() => setRenameBoard(board)}>
                          {t('renameAction')}
                        </DropdownMenuItem>
                      ) : null}
                      {canDelete ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteBoard(board)}
                        >
                          {t('deleteAction')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <CreateBoardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={activeId}
        onCreated={(board) => setBoards((current) => [...current, board])}
      />
      <RenameBoardDialog
        open={renameBoard !== null}
        onOpenChange={(open) => {
          if (!open) setRenameBoard(null);
        }}
        workspaceId={activeId}
        board={renameBoard}
        onRenamed={(board) =>
          setBoards((current) => current.map((item) => (item.id === board.id ? board : item)))
        }
      />
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
