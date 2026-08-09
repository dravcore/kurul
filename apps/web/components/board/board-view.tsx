'use client';

import Link from 'next/link';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, ColumnDto } from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
import { canMutateColumns } from '@/lib/board-permissions';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Topbar } from '@/components/layout/topbar';
import { BoardColumn } from './board-column';
import { CreateColumnDialog } from './create-column-dialog';
import { DeleteColumnDialog } from './delete-column-dialog';
import { RenameColumnDialog } from './rename-column-dialog';
import { DamgaMark } from '@/components/brand/damga-mark';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'] as const;

interface BoardViewProps {
  boardId: string;
}

export function BoardView({ boardId }: BoardViewProps): React.ReactElement {
  const t = useTranslations('app.board');
  const { activeId, activeRole } = useWorkspaceContext();
  const [board, setBoard] = useState<BoardDto | null>(null);
  const [columns, setColumns] = useState<ColumnDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameColumn, setRenameColumn] = useState<ColumnDto | null>(null);
  const [deleteColumn, setDeleteColumn] = useState<ColumnDto | null>(null);
  const [defaultsPending, setDefaultsPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [entranceDone, setEntranceDone] = useState(false);

  const canMutate = canMutateColumns(activeRole);

  useEffect(() => {
    if (loading || entranceDone) return;
    const timeout = window.setTimeout(
      () => setEntranceDone(true),
      columns.length * 40 + 250,
    );
    return () => window.clearTimeout(timeout);
  }, [loading, entranceDone, columns.length]);

  const reload = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    const [nextBoard, nextColumns] = await Promise.all([
      api.get<BoardDto>(`/workspaces/${activeId}/boards/${boardId}`),
      api.get<ColumnDto[]>(`/workspaces/${activeId}/boards/${boardId}/columns`),
    ]);
    setBoard(nextBoard);
    setColumns(nextColumns);
  }, [activeId, boardId]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await reload();
      } catch {
        if (!controller.signal.aborted) {
          setError(t('loadError'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [activeId, boardId, reload, t]);

  async function moveColumn(column: ColumnDto, direction: -1 | 1): Promise<void> {
    if (!activeId) return;
    const index = columns.findIndex((item) => item.id === column.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= columns.length) return;

    const without = columns.filter((item) => item.id !== column.id);
    const before = without[targetIndex - 1] ?? null;
    const after = without[targetIndex] ?? null;
    setActionError(null);
    try {
      const updated = await api.patch<ColumnDto>(
        `/workspaces/${activeId}/columns/${column.id}/position`,
        {
          beforeColumnId: before?.id ?? null,
          afterColumnId: after?.id ?? null,
        },
      );
      const next = [...without];
      next.splice(targetIndex, 0, updated);
      setColumns(next);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setActionError(t('errors.forbiddenColumns'));
      } else {
        setActionError(t('column.moveError'));
      }
    }
  }

  async function seedDefaults(): Promise<void> {
    if (!activeId) return;
    setDefaultsPending(true);
    setActionError(null);
    try {
      let afterColumnId: string | undefined;
      const created: ColumnDto[] = [];
      for (const name of DEFAULT_COLUMNS) {
        const column = await api.post<ColumnDto>(
          `/workspaces/${activeId}/boards/${boardId}/columns`,
          {
            name,
            ...(afterColumnId ? { afterColumnId } : {}),
          },
        );
        created.push(column);
        afterColumnId = column.id;
      }
      setColumns(created);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setActionError(t('errors.forbiddenColumns'));
      } else {
        setActionError(t('column.defaultsError'));
      }
    } finally {
      setDefaultsPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex gap-3 overflow-x-auto p-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-[var(--column-width)] shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-destructive">{error ?? t('loadError')}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('backToBoards')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Topbar
        title={board.name}
        leading={
          <Button asChild variant="ghost" size="icon-sm" aria-label={t('backToBoards')}>
            <Link href="/dashboard">
              <ArrowLeft />
            </Link>
          </Button>
        }
        actions={
          canMutate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('boardMenu')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {t('column.createAction')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      {actionError ? (
        <p className="border-b border-border px-4 py-2 text-sm text-destructive">{actionError}</p>
      ) : null}

      {columns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <DamgaMark />
          <h2 className="font-display text-xl font-semibold">{t('column.emptyTitle')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('column.emptyBody')}</p>
          {canMutate ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" onClick={() => setCreateOpen(true)}>
                {t('column.createAction')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={defaultsPending}
                onClick={() => void seedDefaults()}
              >
                {t('column.useDefaults')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-destructive">{t('errors.forbiddenColumns')}</p>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {columns.map((column, index) => (
            <BoardColumn
              key={column.id}
              column={column}
              canMutate={canMutate}
              canMoveLeft={index > 0}
              canMoveRight={index < columns.length - 1}
              onRename={() => setRenameColumn(column)}
              onDelete={() => setDeleteColumn(column)}
              onMoveLeft={() => void moveColumn(column, -1)}
              onMoveRight={() => void moveColumn(column, 1)}
              className={entranceDone ? undefined : 'board-column-enter'}
              style={entranceDone ? undefined : ({ '--stagger-index': index } as React.CSSProperties)}
            />
          ))}
          {canMutate ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-[var(--column-width)] min-w-[280px] shrink-0"
              onClick={() => setCreateOpen(true)}
            >
              <Plus />
              {t('column.createAction')}
            </Button>
          ) : null}
        </div>
      )}

      {activeId ? (
        <>
          <CreateColumnDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            workspaceId={activeId}
            boardId={boardId}
            afterColumnId={columns.at(-1)?.id}
            onCreated={(column) => setColumns((current) => [...current, column])}
          />
          <RenameColumnDialog
            open={renameColumn !== null}
            onOpenChange={(open) => {
              if (!open) setRenameColumn(null);
            }}
            workspaceId={activeId}
            column={renameColumn}
            onRenamed={(column) =>
              setColumns((current) =>
                current.map((item) => (item.id === column.id ? column : item)),
              )
            }
          />
          <DeleteColumnDialog
            open={deleteColumn !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteColumn(null);
            }}
            workspaceId={activeId}
            column={deleteColumn}
            onDeleted={(columnId) =>
              setColumns((current) => current.filter((item) => item.id !== columnId))
            }
          />
        </>
      ) : null}
    </div>
  );
}
