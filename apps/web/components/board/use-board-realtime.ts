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
import type { ColumnDto, TaskDto } from '@kurul/shared-types';
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

/** The `task-card-remote-change` keyframe's duration in app/globals.css: the mark drives the
 * tint, so the two have to agree or the card is left carrying an attribute nothing draws. */
const REMOTE_CHANGE_MS = 1_200;

const NO_REMOTE_CHANGES: ReadonlySet<string> = new Set<string>();

/**
 * How long resync triggers are coalesced. A room join acks on every (re)connection, so a
 * flapping link would otherwise start one full board drain per flap.
 */
const RESYNC_DEBOUNCE_MS = 400;

/**
 * A drain that started this recently already carries everything a join could ask for, so
 * the resync is dropped instead of repeating it. This is what stops the very first join —
 * which happens right after the initial load, since the socket only enables once loading
 * settles — from immediately draining the whole board a second time.
 */
const RESYNC_FRESH_WINDOW_MS = 3_000;

/**
 * Applies board room events to the local caches. Socket payloads carry ids only, so a
 * created or updated task is refetched — debounced per id, since a burst of edits to the
 * same card should cost one request, not one per event.
 *
 * A room join acks with a resync request, which is the one path that still costs a full
 * board drain (the API has no "changes since" read, and a drain is the only way to learn
 * about rows deleted while the socket was down). It is therefore debounced, single-flight,
 * and skipped outright when a drain already ran moments ago.
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
}: UseBoardRealtimeOptions): {
  connected: boolean;
  /** Cards a *different* member just moved or edited, for as long as their tint is fading. */
  remoteChangedTaskIds: ReadonlySet<string>;
} {
  const t = useTranslations('app.board');
  const { activeId } = useWorkspaceContext();
  const upsertTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [remoteChangedTaskIds, setRemoteChangedTaskIds] =
    useState<ReadonlySet<string>>(NO_REMOTE_CHANGES);
  const remoteChangeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = remoteChangeTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /** True for an event this session caused, echoed back to it off the room. */
  const isOwnEcho = useCallback(
    (actorId: string): boolean => currentUserId !== null && actorId === currentUserId,
    [currentUserId],
  );

  const markRemoteChanged = useCallback((taskId: string): void => {
    const pending = remoteChangeTimersRef.current.get(taskId);
    if (pending) clearTimeout(pending);
    setRemoteChangedTaskIds((current) => {
      if (current.has(taskId)) return current;
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
    remoteChangeTimersRef.current.set(
      taskId,
      setTimeout(() => {
        remoteChangeTimersRef.current.delete(taskId);
        setRemoteChangedTaskIds((current) => {
          if (!current.has(taskId)) return current;
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }, REMOTE_CHANGE_MS),
    );
  }, []);

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

  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncRunningRef = useRef(false);
  const resyncQueuedRef = useRef(false);
  const lastDrainStartedAtRef = useRef(0);
  // Read through a ref so a debounced resync runs the current filters, not the ones that
  // were active when the timer was armed.
  const runResyncRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Mount counts as a drain, so a join landing right behind the initial load does not queue
  // a resync on top of data that is already arriving. Seeded here rather than as the
  // `useRef` initial value because `Date.now()` is impure and must not be read during
  // render — an aborted or replayed render would stamp a time the commit never happened at.
  useEffect(() => {
    lastDrainStartedAtRef.current = Date.now();
  }, []);

  // The board data hook clears `loading` when a drain has painted the board, which is the
  // freshness a join would otherwise ask us to re-fetch.
  useEffect(() => {
    if (!loading) lastDrainStartedAtRef.current = Date.now();
  }, [loading]);

  /** Debounced, single-flight board resync. */
  const requestResync = useCallback((): void => {
    if (Date.now() - lastDrainStartedAtRef.current < RESYNC_FRESH_WINDOW_MS) return;
    if (resyncRunningRef.current) {
      resyncQueuedRef.current = true;
      return;
    }
    if (resyncTimerRef.current !== null) clearTimeout(resyncTimerRef.current);
    resyncTimerRef.current = setTimeout(() => {
      resyncTimerRef.current = null;
      void runResyncRef.current();
    }, RESYNC_DEBOUNCE_MS);
  }, []);

  const runResync = useCallback(async (): Promise<void> => {
    resyncRunningRef.current = true;
    resyncQueuedRef.current = false;
    lastDrainStartedAtRef.current = Date.now();
    try {
      await reload();
    } catch {
      // Keep the last known board; the next event or reconnect asks again.
    } finally {
      resyncRunningRef.current = false;
      if (resyncQueuedRef.current) {
        resyncQueuedRef.current = false;
        requestResync();
      }
    }
  }, [reload, requestResync]);

  useEffect(() => {
    runResyncRef.current = runResync;
  }, [runResync]);

  useEffect(
    () => () => {
      if (resyncTimerRef.current !== null) clearTimeout(resyncTimerRef.current);
      resyncTimerRef.current = null;
    },
    [],
  );

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

  const { connected } = useBoardSocket(boardId, Boolean(activeId) && !loading, {
    onResync: requestResync,
    onTaskCreated: (payload) => {
      if (tasksRef.current.some((task) => task.id === payload.taskId)) return;
      void upsertRemoteTask(payload.taskId);
    },
    onTaskUpdated: (payload) => {
      if (!isOwnEcho(payload.actorId)) markRemoteChanged(payload.taskId);
      void upsertRemoteTask(payload.taskId);
    },
    onTaskMoved: (payload) => {
      const ownEcho = isOwnEcho(payload.actorId);
      if (!ownEcho) {
        markRemoteChanged(payload.taskId);
        if (dndRef.current?.isDragging) {
          dndRef.current.cancelDrag();
          toast.message(t('realtime.dragCancelled'));
        }
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === payload.taskId
            ? { ...task, columnId: payload.columnId, position: payload.position }
            : task,
        ),
      );
      if (!ownEcho && !tasksRef.current.some((task) => task.id === payload.taskId)) {
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

  return { connected, remoteChangedTaskIds };
}
