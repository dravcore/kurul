'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from '@dnd-kit/core';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { canMutateColumns, canMutateLabels, canMutateTasks } from '@/lib/board-permissions';
import {
  countActiveFilters,
  hasActiveFilters,
  mergeFiltersIntoSearchParams,
  parseFiltersFromSearchParams,
  type BoardTaskFilters,
} from '@/lib/task-query';
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
import { CreateTaskDialog } from '@/components/task/create-task-dialog';
import { DeleteTaskDialog } from '@/components/task/delete-task-dialog';
import { TaskPanel } from '@/components/task/task-panel';
import { TaskDragPreview } from '@/components/task/sortable-task-card';
import { useBoardTaskDnd, type TaskMovePayload } from '@/components/task/use-board-task-dnd';
import { BoardColumn } from './board-column';
import { BoardFilters } from './board-filters';
import { CreateColumnDialog } from './create-column-dialog';
import { DeleteColumnDialog } from './delete-column-dialog';
import { RenameColumnDialog } from './rename-column-dialog';
import { DamgaMark } from '@/components/brand/damga-mark';
import { useBoardData } from './use-board-data';
import { useBoardSocket } from './use-board-socket';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'] as const;

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

interface BoardViewProps {
  boardId: string;
  selectedTaskId?: string | null;
}

export function BoardView({ boardId, selectedTaskId = null }: BoardViewProps): React.ReactElement {
  const t = useTranslations('app.board');
  const tTask = useTranslations('app.board.task');
  const tFilter = useTranslations('app.board.filter');
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeId, activeRole } = useWorkspaceContext();
  const [createColumnOpen, setCreateColumnOpen] = useState(false);
  const [createTaskColumnId, setCreateTaskColumnId] = useState<string | null>(null);
  const [renameColumn, setRenameColumn] = useState<ColumnDto | null>(null);
  const [deleteColumn, setDeleteColumn] = useState<ColumnDto | null>(null);
  const [deleteTask, setDeleteTask] = useState<TaskDto | null>(null);
  const [defaultsPending, setDefaultsPending] = useState(false);
  const [entranceDone, setEntranceDone] = useState(false);
  const dndRef = useRef<{ cancelDrag: () => void; isDragging: boolean } | null>(null);

  const filterKey = searchParams.toString();
  const filters = useMemo(
    () => parseFiltersFromSearchParams(new URLSearchParams(filterKey)),
    [filterKey],
  );
  const filtersActive = hasActiveFilters(filters);

  const {
    board,
    columns,
    tasks,
    members,
    labels,
    loading,
    error,
    panelError,
    metaRefreshKey,
    columnsRef,
    tasksRef,
    reload,
    setColumns,
    setTasks,
    setMetaRefreshKey,
  } = useBoardData(boardId, filters, selectedTaskId);

  const canMutateColumnsFlag = canMutateColumns(activeRole);
  const canMutateTasksFlag = canMutateTasks(activeRole);
  const canMutateLabelsFlag = canMutateLabels(activeRole);

  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks],
  );

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const column of columns) {
      map.set(column.id, []);
    }
    for (const task of tasks) {
      const list = map.get(task.columnId);
      if (list) list.push(task);
      else map.set(task.columnId, [task]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    return map;
  }, [columns, tasks]);

  useEffect(() => {
    if (loading || entranceDone) return;
    const timeout = window.setTimeout(() => setEntranceDone(true), columns.length * 40 + 250);
    return () => window.clearTimeout(timeout);
  }, [loading, entranceDone, columns.length]);

  const applyFilters = useCallback(
    (next: BoardTaskFilters): void => {
      const params = mergeFiltersIntoSearchParams(
        new URLSearchParams(searchParams.toString()),
        next,
      );
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  async function commitTaskMove(payload: TaskMovePayload): Promise<void> {
    if (!activeId) return;
    setTasks(payload.nextTasks);
    try {
      const updated = await api.patch<TaskDto>(
        `/workspaces/${activeId}/tasks/${payload.taskId}/position`,
        {
          columnId: payload.columnId,
          beforeTaskId: payload.beforeTaskId,
          afterTaskId: payload.afterTaskId,
        },
      );
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
    } catch (caught) {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== payload.taskId) return task;
          return payload.previousTasks.find((previous) => previous.id === payload.taskId) ?? task;
        }),
      );
      if (caught instanceof ApiError && caught.statusCode === 403) {
        toast.error(t('errors.forbiddenTasks'));
      } else {
        toast.error(tTask('moveError'), {
          action: {
            label: tTask('retryAction'),
            onClick: () => void commitTaskMove(payload),
          },
        });
      }
    }
  }

  const dnd = useBoardTaskDnd(tasks, canMutateTasksFlag, commitTaskMove, (title) =>
    tTask('movedAnnouncement', { title }),
  );
  dndRef.current = { cancelDrag: dnd.cancelDrag, isDragging: dnd.isDragging };

  const upsertTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const upsertRemoteTask = useCallback(
    (taskId: string): void => {
      if (!activeId) return;
      const pending = upsertTimersRef.current.get(taskId);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        upsertTimersRef.current.delete(taskId);
        void (async () => {
          try {
            const remote = await api.get<TaskDto>(`/workspaces/${activeId}/tasks/${taskId}`);
            setTasks((current) => {
              const index = current.findIndex((task) => task.id === taskId);
              if (index < 0) return [...current, remote];
              const next = [...current];
              next[index] = remote;
              return next;
            });
          } catch {
            // Task may have been deleted before fetch completed.
          }
        })();
      }, 120);
      upsertTimersRef.current.set(taskId, timer);
    },
    [activeId, setTasks],
  );

  useEffect(() => {
    return () => {
      for (const timer of upsertTimersRef.current.values()) clearTimeout(timer);
      upsertTimersRef.current.clear();
    };
  }, []);

  const refetchColumns = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    try {
      const nextColumns = await api.get<ColumnDto[]>(
        `/workspaces/${activeId}/boards/${boardId}/columns`,
      );
      setColumns(nextColumns);
    } catch {
      // Keep last known columns.
    }
  }, [activeId, boardId, setColumns]);

  const { connected: socketConnected } = useBoardSocket(boardId, Boolean(activeId) && !loading, {
    onResync: () => {
      void reload();
    },
    onTaskCreated: (payload) => {
      if (tasksRef.current.some((task) => task.id === payload.taskId)) return;
      void upsertRemoteTask(payload.taskId);
    },
    onTaskUpdated: (payload) => {
      void upsertRemoteTask(payload.taskId);
    },
    onTaskMoved: (payload) => {
      const remoteActor = currentUserId !== null && payload.actorId === currentUserId;
      if (!remoteActor && dndRef.current?.isDragging) {
        dndRef.current.cancelDrag();
        toast.message(t('realtime.dragCancelled'));
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === payload.taskId
            ? { ...task, columnId: payload.columnId, position: payload.position }
            : task,
        ),
      );
      if (!remoteActor && !tasksRef.current.some((task) => task.id === payload.taskId)) {
        void upsertRemoteTask(payload.taskId);
      }
    },
    onTaskDeleted: (payload) => {
      setTasks((current) => current.filter((task) => task.id !== payload.taskId));
    },
    onColumnChanged: () => {
      void refetchColumns();
    },
    onCommentAdded: (payload) => {
      if (payload.taskId === selectedTaskId) {
        setMetaRefreshKey((value) => value + 1);
      }
    },
  });

  async function moveColumn(column: ColumnDto, direction: -1 | 1): Promise<void> {
    if (!activeId) return;
    const current = columnsRef.current;
    const index = current.findIndex((item) => item.id === column.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;

    const without = current.filter((item) => item.id !== column.id);
    const before = without[targetIndex - 1] ?? null;
    const after = without[targetIndex] ?? null;
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
        toast.error(t('errors.forbiddenColumns'));
      } else {
        toast.error(t('column.moveError'), {
          action: {
            label: t('column.retryAction'),
            onClick: () => void moveColumn(column, direction),
          },
        });
      }
    }
  }

  async function seedDefaults(): Promise<void> {
    if (!activeId) return;
    setDefaultsPending(true);
    const created: ColumnDto[] = [];
    try {
      let afterColumnId: string | undefined;
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
        toast.error(t('errors.forbiddenColumns'));
      } else if (created.length > 0) {
        setColumns(created);
        try {
          await reload();
        } catch {
          // ignore reload failure — a plain error toast still shows
        }
        toast.error(t('column.defaultsError'));
      } else {
        toast.error(t('column.defaultsError'), {
          action: {
            label: t('column.retryAction'),
            onClick: () => void seedDefaults(),
          },
        });
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
        <h1 className="text-title text-destructive">{error ?? t('loadError')}</h1>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('backToBoards')}</Link>
        </Button>
      </div>
    );
  }

  const panelOpen = selectedTaskId !== null;

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
          <div className="flex items-center gap-2">
            {!socketConnected ? (
              <span className="text-micro text-muted-foreground" aria-live="polite">
                {t('realtime.reconnecting')}
              </span>
            ) : null}
            {canMutateColumnsFlag ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('boardMenu')}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCreateColumnOpen(true)}>
                    <Plus />
                    {t('column.createAction')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        }
      />

      <div className="border-b border-border px-3 py-2">
        <BoardFilters filters={filters} members={members} labels={labels} onChange={applyFilters} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {columns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <DamgaMark />
              <h2 className="font-display text-title-lg font-semibold">{t('column.emptyTitle')}</h2>
              <p className="max-w-md text-body text-muted-foreground">{t('column.emptyBody')}</p>
              {canMutateColumnsFlag ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button type="button" onClick={() => setCreateColumnOpen(true)}>
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
                <p className="text-body text-destructive">{t('errors.forbiddenColumns')}</p>
              )}
            </div>
          ) : filtersActive && tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <h2 className="text-title">{tFilter('emptyTitle')}</h2>
              <p className="max-w-md text-body text-muted-foreground">
                {tFilter('emptyBody', { count: countActiveFilters(filters) })}
              </p>
              <Button type="button" variant="outline" onClick={() => applyFilters({})}>
                {tFilter('clearAll')}
              </Button>
            </div>
          ) : (
            <DndContext
              sensors={dnd.sensors}
              collisionDetection={dnd.collisionDetection}
              onDragStart={dnd.onDragStart}
              onDragEnd={dnd.onDragEnd}
              onDragCancel={dnd.onDragCancel}
            >
              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
                {columns.map((column, index) => (
                  <BoardColumn
                    key={column.id}
                    column={column}
                    tasks={tasksByColumn.get(column.id) ?? []}
                    boardId={boardId}
                    selectedTaskId={selectedTaskId}
                    canMutateColumns={canMutateColumnsFlag}
                    canMutateTasks={canMutateTasksFlag}
                    canMoveLeft={index > 0}
                    canMoveRight={index < columns.length - 1}
                    onRename={() => setRenameColumn(column)}
                    onDelete={() => setDeleteColumn(column)}
                    onMoveLeft={() => void moveColumn(column, -1)}
                    onMoveRight={() => void moveColumn(column, 1)}
                    onAddTask={() => setCreateTaskColumnId(column.id)}
                    className={entranceDone ? undefined : 'board-column-enter'}
                    style={
                      entranceDone
                        ? undefined
                        : ({ '--stagger-index': index } as React.CSSProperties)
                    }
                  />
                ))}
                {canMutateColumnsFlag ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-[var(--column-width)] min-w-[280px] shrink-0"
                    onClick={() => setCreateColumnOpen(true)}
                  >
                    <Plus />
                    {t('column.createAction')}
                  </Button>
                ) : null}
              </div>
              <DragOverlay dropAnimation={dropAnimation}>
                {dnd.activeTask ? <TaskDragPreview task={dnd.activeTask} /> : null}
              </DragOverlay>
              <div className="sr-only" aria-live="polite">
                {dnd.announcement}
              </div>
            </DndContext>
          )}
        </div>

        {panelOpen && activeId ? (
          <TaskPanel
            workspaceId={activeId}
            boardId={boardId}
            task={selectedTask}
            canMutate={canMutateTasksFlag}
            canManageLabels={canMutateLabelsFlag}
            members={members}
            labels={labels}
            loadError={panelError}
            metaRefreshKey={metaRefreshKey}
            onUpdated={(patch) =>
              setTasks((current) =>
                current.some((item) => item.id === patch.id)
                  ? current.map((item) => (item.id === patch.id ? { ...item, ...patch } : item))
                  : [...current, patch as TaskDto],
              )
            }
            onRequestDelete={() => {
              if (selectedTask) setDeleteTask(selectedTask);
            }}
          />
        ) : null}
      </div>

      {activeId ? (
        <>
          <CreateColumnDialog
            open={createColumnOpen}
            onOpenChange={setCreateColumnOpen}
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
            onDeleted={(columnId) => {
              setColumns((current) => current.filter((item) => item.id !== columnId));
              setTasks((current) => current.filter((task) => task.columnId !== columnId));
            }}
          />
          <CreateTaskDialog
            open={createTaskColumnId !== null}
            onOpenChange={(open) => {
              if (!open) setCreateTaskColumnId(null);
            }}
            workspaceId={activeId}
            boardId={boardId}
            columnId={createTaskColumnId ?? ''}
            onCreated={(task) => setTasks((current) => [...current, task])}
          />
          <DeleteTaskDialog
            open={deleteTask !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTask(null);
            }}
            workspaceId={activeId}
            task={deleteTask}
            onDeleted={(taskId) => {
              setTasks((current) => current.filter((task) => task.id !== taskId));
              if (selectedTaskId === taskId) {
                router.push(`/board/${boardId}`);
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}
