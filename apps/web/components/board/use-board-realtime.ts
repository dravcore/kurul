'use client';

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { useBoardSocket } from './use-board-socket';

/** The slice of the dnd hook realtime needs: a moved card must not fight an in-flight drag. */
export type BoardDndHandle = {
  cancelDrag: () => void;
  isDragging: boolean;
};

export type UseBoardRealtimeOptions = {
  boardId: string;
  /** Socket joins only after the first load settles, same as the REST fetches. */
  loading: boolean;
  currentUserId: string | null;
  selectedTaskId: string | null;
  dndRef: React.RefObject<BoardDndHandle | null>;
  tasksRef: React.MutableRefObject<TaskDto[]>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setMetaRefreshKey: Dispatch<SetStateAction<number>>;
  reload: () => Promise<void>;
};

/** How long an id is coalesced before its refetch fires. */
const UPSERT_DEBOUNCE_MS = 120;

/**
 * Applies board room events to the local caches. Socket payloads carry ids only, so a
 * created or updated task is refetched — debounced per id, since a burst of edits to the
 * same card should cost one request, not one per event.
 */
export function useBoardRealtime({
  boardId,
  loading,
  currentUserId,
  selectedTaskId,
  dndRef,
  tasksRef,
  setTasks,
  setColumns,
  setMetaRefreshKey,
  reload,
}: UseBoardRealtimeOptions): { connected: boolean } {
  const t = useTranslations('app.board');
  const { activeId } = useWorkspaceContext();
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
      }, UPSERT_DEBOUNCE_MS);
      upsertTimersRef.current.set(taskId, timer);
    },
    [activeId, setTasks],
  );

  useEffect(() => {
    const timers = upsertTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
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

  return useBoardSocket(boardId, Boolean(activeId) && !loading, {
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
}
