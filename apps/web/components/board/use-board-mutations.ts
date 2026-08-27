'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  type ColumnDto,
  type MoveColumnRequest,
  type MoveTaskRequest,
  type TaskDto,
} from '@kurul/shared-types';
import { api, apiStatus } from '@/lib/api';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import type { TaskMovePayload } from '@/components/task/use-board-task-dnd';

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
  /** Cards that were just rolled back, for as long as their return is playing. */
  returningTaskIds: ReadonlySet<string>;
  moveColumn: (column: ColumnDto, direction: -1 | 1) => Promise<void>;
  seedDefaults: () => Promise<void>;
  defaultsPending: boolean;
};

/**
 * Every refused move updates this one toast instead of adding to the stack: a board that cannot
 * reach the API fails once per drag, and three drags in a row are one problem, not three.
 */
const MOVE_FAILURE_TOAST_ID = 'board-task-move-failed';

/**
 * How long a toast carrying a control stays up, against the 4s a plain one gets
 * (components/ui/sonner.tsx). A `Try again` nobody has time to reach is worse than none.
 */
const ACTION_TOAST_MS = 8_000;

/** The `task-card-return` keyframe's duration in app/globals.css. The mark drives the play, so
 * the two have to agree: dropped early the card jumps, dropped late nothing is drawn but the
 * attribute is still on the element. */
const RETURN_ANIMATION_MS = 220;

const NO_RETURNING_TASKS: ReadonlySet<string> = new Set<string>();

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
  const [returningTaskIds, setReturningTaskIds] = useState<ReadonlySet<string>>(NO_RETURNING_TASKS);
  const returnTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = returnTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /** Marks a card as returning to where it was, for exactly as long as the return is drawn. */
  const markReturning = useCallback((taskId: string): void => {
    const pending = returnTimersRef.current.get(taskId);
    if (pending) clearTimeout(pending);
    setReturningTaskIds((current) => {
      if (current.has(taskId)) return current;
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
    returnTimersRef.current.set(
      taskId,
      setTimeout(() => {
        returnTimersRef.current.delete(taskId);
        setReturningTaskIds((current) => {
          if (!current.has(taskId)) return current;
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }, RETURN_ANIMATION_MS),
    );
  }, []);
  // Overlapping drags each capture their own pre-move snapshot. A late failure from an
  // earlier PATCH must not `setTasks` that snapshot back — it would wipe a newer optimistic
  // (or already-accepted) order. Only the latest in-flight generation may roll back; older
  // failures resync from the server instead.
  const moveGenerationRef = useRef(0);

  const commitTaskMove = useCallback(
    async function commit(payload: TaskMovePayload): Promise<void> {
      if (!activeId) return;
      const generation = ++moveGenerationRef.current;
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
        if (generation === moveGenerationRef.current) {
          setTasks(previousTasks);
        } else {
          try {
            await reload();
          } catch {
            // Toast below still explains the failed move; a stale board is preferable to a
            // wrong rollback of a newer drag.
          }
        }
        markReturning(payload.taskId);
        if (apiStatus(caught) === 403) {
          toast.error(t('task.forbidden'), { id: MOVE_FAILURE_TOAST_ID });
        } else {
          toast.error(t('dragFailed'), {
            id: MOVE_FAILURE_TOAST_ID,
            duration: ACTION_TOAST_MS,
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
    [activeId, markReturning, reload, setTasks, t, tTask, tasksRef],
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
          toast.error(t('column.forbidden'));
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

  /**
   * Recreates the starting columns on a board that was left with none.
   *
   * One request. This used to be a serial loop of three POSTs — serial because `afterColumnId`
   * was what pinned the order — which meant the third could fail and leave the board holding
   * two columns, indistinguishable from a set the user had trimmed on purpose. The endpoint
   * seeds them in a single transaction and answers with the whole list, so there is no partial
   * state to reconcile and no order for the client to maintain.
   *
   * The names come back from the server rather than being sent: they are written in the
   * creator's language (ADR 0018), and the categories that make the dashboard recognise the
   * Done column travel with them.
   */
  const seedDefaults = useCallback(
    async function seed(): Promise<void> {
      if (!activeId) return;
      setDefaultsPending(true);
      try {
        const created = await api.post<ColumnDto[]>(
          `/workspaces/${activeId}/boards/${boardId}/columns/defaults`,
          undefined,
        );
        setColumns(created);
      } catch (caught) {
        const status = apiStatus(caught);
        if (status === 403) {
          toast.error(t('column.forbidden'));
        } else if (status === 409) {
          // Someone else seeded this board while the empty state was on screen. Nothing
          // failed — this view is simply stale, so refresh it instead of offering a retry
          // that would conflict again.
          try {
            await reload();
          } catch {
            // ignore reload failure — the toast below still explains the situation
          }
          toast.error(t('column.defaultsConflict'));
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

  return { commitTaskMove, returningTaskIds, moveColumn, seedDefaults, defaultsPending };
}
