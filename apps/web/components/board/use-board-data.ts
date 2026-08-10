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
import type {
  BoardDto,
  ColumnDto,
  LabelDto,
  TaskDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { fetchAllBoardTasks, type BoardTaskFilters } from '@/lib/task-query';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';

export type UseBoardDataResult = {
  board: BoardDto | null;
  columns: ColumnDto[];
  tasks: TaskDto[];
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  loading: boolean;
  /** True while task pages are still draining behind an already-painted board. */
  tasksSyncing: boolean;
  error: string | null;
  panelError: string | null;
  metaRefreshKey: number;
  columnsRef: React.MutableRefObject<ColumnDto[]>;
  tasksRef: React.MutableRefObject<TaskDto[]>;
  reloadBoardMeta: (signal?: AbortSignal) => Promise<void>;
  reloadTasks: (signal?: AbortSignal) => Promise<void>;
  reload: (signal?: AbortSignal) => Promise<void>;
  setBoard: Dispatch<SetStateAction<BoardDto | null>>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  setMembers: Dispatch<SetStateAction<WorkspaceMemberDto[]>>;
  setLabels: Dispatch<SetStateAction<LabelDto[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setPanelError: Dispatch<SetStateAction<string | null>>;
  setMetaRefreshKey: Dispatch<SetStateAction<number>>;
};

export function useBoardData(
  boardId: string,
  filters: BoardTaskFilters,
  selectedTaskId: string | null = null,
): UseBoardDataResult {
  const t = useTranslations('app.board');
  const tTask = useTranslations('app.board.task');
  const { activeId } = useWorkspaceContext();

  const [board, setBoard] = useState<BoardDto | null>(null);
  const [columns, setColumns] = useState<ColumnDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberDto[]>([]);
  const [labels, setLabels] = useState<LabelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksSyncing, setTasksSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);

  const columnsRef = useRef<ColumnDto[]>([]);
  const tasksRef = useRef<TaskDto[]>([]);
  const loadedBoardIdRef = useRef<string | null>(null);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const reloadBoardMeta = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!activeId) return;
      const [nextBoard, nextColumns, nextMembers, nextLabels] = await Promise.all([
        api.get<BoardDto>(`/workspaces/${activeId}/boards/${boardId}`, { signal }),
        api.get<ColumnDto[]>(`/workspaces/${activeId}/boards/${boardId}/columns`, { signal }),
        api.get<WorkspaceMemberDto[]>(`/workspaces/${activeId}/members`, { signal }),
        api.get<LabelDto[]>(`/workspaces/${activeId}/boards/${boardId}/labels`, { signal }),
      ]);
      if (signal?.aborted) return;
      setBoard(nextBoard);
      setColumns(nextColumns);
      setMembers(nextMembers);
      setLabels(nextLabels);
    },
    [activeId, boardId],
  );

  /**
   * Streams the task pages into state instead of waiting for the whole drain: page 0
   * replaces the board (it is the fresh truth the caller asked for), later pages only add
   * the ids they bring. Appending rather than replacing is what keeps an optimistic drag or
   * a realtime patch applied mid-drain from being overwritten by a page that was already
   * in flight when it happened.
   */
  const drainTasks = useCallback(
    async (signal?: AbortSignal, onFirstPage?: () => void): Promise<void> => {
      if (!activeId) return;
      setTasksSyncing(true);
      try {
        await fetchAllBoardTasks(activeId, boardId, filters, {
          init: { signal },
          onPage: ({ items, index }) => {
            if (signal?.aborted) return;
            if (index === 0) {
              setTasks(items);
              onFirstPage?.();
              return;
            }
            setTasks((current) => {
              const known = new Set(current.map((task) => task.id));
              const added = items.filter((task) => !known.has(task.id));
              return added.length > 0 ? [...current, ...added] : current;
            });
          },
        });
      } finally {
        if (!signal?.aborted) setTasksSyncing(false);
      }
    },
    [activeId, boardId, filters],
  );

  const reloadTasks = useCallback(
    (signal?: AbortSignal): Promise<void> => drainTasks(signal),
    [drainTasks],
  );

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      await Promise.all([reloadBoardMeta(signal), reloadTasks(signal)]);
    },
    [reloadBoardMeta, reloadTasks],
  );

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const isInitial = loadedBoardIdRef.current !== boardId;
    if (isInitial) setLoading(true);
    setError(null);
    void (async () => {
      const reveal = (): void => {
        if (!controller.signal.aborted) setLoading(false);
      };
      try {
        if (isInitial) {
          let firstPageArrived = (): void => {};
          const firstPage = new Promise<void>((resolve) => {
            firstPageArrived = resolve;
          });
          const metaDone = reloadBoardMeta(controller.signal);
          const tasksDone = drainTasks(controller.signal, firstPageArrived);
          // The frame (columns) plus the first page is enough to paint the board; the
          // remaining pages stream in behind it instead of holding the skeleton up.
          void Promise.all([metaDone, firstPage]).then(reveal, () => {
            // Failure is reported by the await below.
          });
          await Promise.all([metaDone, tasksDone]);
        } else {
          await reloadTasks(controller.signal);
        }
        if (!controller.signal.aborted) {
          loadedBoardIdRef.current = boardId;
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(t('loadError'));
        }
      } finally {
        reveal();
      }
    })();
    return () => controller.abort();
  }, [activeId, boardId, filters, drainTasks, reloadBoardMeta, reloadTasks, t]);

  useEffect(() => {
    if (!activeId || !selectedTaskId || loading) {
      setPanelError(null);
      return;
    }
    if (tasksRef.current.some((task) => task.id === selectedTaskId)) {
      setPanelError(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const task = await api.get<TaskDto>(`/workspaces/${activeId}/tasks/${selectedTaskId}`);
        if (!controller.signal.aborted) {
          setTasks((current) =>
            current.some((item) => item.id === task.id) ? current : [...current, task],
          );
          setPanelError(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPanelError(tTask('missing'));
        }
      }
    })();
    return () => controller.abort();
  }, [activeId, selectedTaskId, loading, tTask]);

  return {
    board,
    columns,
    tasks,
    members,
    labels,
    loading,
    tasksSyncing,
    error,
    panelError,
    metaRefreshKey,
    columnsRef,
    tasksRef,
    reloadBoardMeta,
    reloadTasks,
    reload,
    setBoard,
    setColumns,
    setTasks,
    setMembers,
    setLabels,
    setLoading,
    setError,
    setPanelError,
    setMetaRefreshKey,
  };
}
