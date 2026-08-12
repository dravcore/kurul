'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ColumnDto,
  CreateColumnRequest,
  MoveColumnRequest,
  MoveTaskRequest,
  TaskDto,
} from '@kurultay/shared-types';
import { api, apiStatus } from '@/lib/api';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import type { TaskMovePayload } from '@/components/task/use-board-task-dnd';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'] as const;

export type UseBoardMutationsOptions = {
  boardId: string;
  columnsRef: React.MutableRefObject<ColumnDto[]>;
  tasksRef: React.MutableRefObject<TaskDto[]>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  reload: () => Promise<void>;
};

export type UseBoardMutationsResult = {
  /** Optimistic task reorder; rolls back and offers a retry when the server rejects it. */
  commitTaskMove: (payload: TaskMovePayload) => Promise<void>;
  moveColumn: (column: ColumnDto, direction: -1 | 1) => Promise<void>;
  seedDefaults: () => Promise<void>;
  defaultsPending: boolean;
};

/**
 * Board write paths: task reorder, column reorder, and the default-column seed. Each owns
 * its own optimistic update, rollback and error toast; the board list state itself lives in
 * `useBoardData`.
 */
export function useBoardMutations({
  boardId,
  columnsRef,
  tasksRef,
  setColumns,
  setTasks,
  reload,
}: UseBoardMutationsOptions): UseBoardMutationsResult {
  const t = useTranslations('app.board');
  const tTask = useTranslations('app.board.task');
  const { activeId } = useWorkspaceContext();
  const [defaultsPending, setDefaultsPending] = useState(false);

  const commitTaskMove = useCallback(
    async function commit(payload: TaskMovePayload): Promise<void> {
      if (!activeId) return;
      const previousTasks = tasksRef.current;
      setTasks(payload.nextTasks);
      try {
        const body: MoveTaskRequest = {
          columnId: payload.columnId,
          beforeTaskId: payload.beforeTaskId,
          afterTaskId: payload.afterTaskId,
        };
        const updated = await api.patch<TaskDto, MoveTaskRequest>(
          `/workspaces/${activeId}/tasks/${payload.taskId}/position`,
          body,
        );
        setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
      } catch (caught) {
        setTasks(previousTasks);
        if (apiStatus(caught) === 403) {
          toast.error(t('errors.forbiddenTasks'));
        } else {
          toast.error(tTask('moveError'), {
            action: {
              label: tTask('retryAction'),
              onClick: () => {
                const latest = tasksRef.current;
                const target = payload.nextTasks.find((task) => task.id === payload.taskId);
                if (!target) return;
                void commit({
                  taskId: payload.taskId,
                  columnId: payload.columnId,
                  beforeTaskId: payload.beforeTaskId,
                  afterTaskId: payload.afterTaskId,
                  previousTasks: latest,
                  nextTasks: latest.map((task) =>
                    task.id === payload.taskId
                      ? { ...task, columnId: payload.columnId, position: target.position }
                      : task,
                  ),
                });
              },
            },
          });
        }
      }
    },
    [activeId, setTasks, t, tTask, tasksRef],
  );

  const moveColumn = useCallback(
    async function move(column: ColumnDto, direction: -1 | 1): Promise<void> {
      if (!activeId) return;
      const current = columnsRef.current;
      const index = current.findIndex((item) => item.id === column.id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;

      const without = current.filter((item) => item.id !== column.id);
      const before = without[targetIndex - 1] ?? null;
      const after = without[targetIndex] ?? null;
      try {
        const body: MoveColumnRequest = {
          beforeColumnId: before?.id ?? null,
          afterColumnId: after?.id ?? null,
        };
        const updated = await api.patch<ColumnDto, MoveColumnRequest>(
          `/workspaces/${activeId}/columns/${column.id}/position`,
          body,
        );
        const next = [...without];
        next.splice(targetIndex, 0, updated);
        setColumns(next);
      } catch (caught) {
        if (apiStatus(caught) === 403) {
          toast.error(t('errors.forbiddenColumns'));
        } else {
          toast.error(t('column.moveError'), {
            action: {
              label: t('column.retryAction'),
              onClick: () => void move(column, direction),
            },
          });
        }
      }
    },
    [activeId, columnsRef, setColumns, t],
  );

  const seedDefaults = useCallback(
    async function seed(): Promise<void> {
      if (!activeId) return;
      setDefaultsPending(true);
      const created: ColumnDto[] = [];
      try {
        let afterColumnId: string | undefined;
        for (const name of DEFAULT_COLUMNS) {
          const body: CreateColumnRequest = {
            name,
            ...(afterColumnId ? { afterColumnId } : {}),
          };
          const column = await api.post<ColumnDto, CreateColumnRequest>(
            `/workspaces/${activeId}/boards/${boardId}/columns`,
            body,
          );
          created.push(column);
          afterColumnId = column.id;
        }
        setColumns(created);
      } catch (caught) {
        if (apiStatus(caught) === 403) {
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
              onClick: () => void seed(),
            },
          });
        }
      } finally {
        setDefaultsPending(false);
      }
    },
    [activeId, boardId, reload, setColumns, t],
  );

  return { commitTaskMove, moveColumn, seedDefaults, defaultsPending };
}
