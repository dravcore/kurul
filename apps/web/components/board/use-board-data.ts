'use client';

import {
  useCallback,
  useEffect,
  useMemo,
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
import { api, apiStatus } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';
import { fetchAllBoardTasks, type BoardTaskFilters } from '@/lib/task-query';
import { useApiResource } from '@/lib/use-api-resource';
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
  /** The deep-linked task has not arrived yet — neither on the board nor from its own fetch. */
  panelLoading: boolean;
  /** A retryable failure to read the deep-linked task. `null` when it is simply not there. */
  panelError: string | null;
  retryPanelTask: () => void;
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
  setMetaRefreshKey: Dispatch<SetStateAction<number>>;
};

export function useBoardData(
  boardId: string,
  filters: BoardTaskFilters,
  selectedTaskId: string | null = null,
): UseBoardDataResult {
  const t = useTranslations('app.board');
  const tErrors = useTranslations('app.errors');
  const { activeId } = useWorkspaceContext();

  const [board, setBoard] = useState<BoardDto | null>(null);
  const [columns, setColumns] = useState<ColumnDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberDto[]>([]);
  const [labels, setLabels] = useState<LabelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksSyncing, setTasksSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        fetchAllWorkspaceMembers(activeId, { signal }),
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

  /**
   * The board load stays on a hand-rolled controller rather than `useApiResource`.
   *
   * The hook models one value arriving once: a single `T`, set when the promise resolves.
   * This load is five values arriving at three different times — the frame (board, columns,
   * members, labels) and the first task page together decide when the skeleton comes down,
   * while the remaining pages keep streaming into the same `tasks` array behind an already
   * painted board. There is no `T` whose single assignment expresses that, and folding the
   * pages into one resolved value would put the skeleton back up until the last page landed,
   * which is the regression this streaming shape exists to avoid.
   */
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

  /**
   * A deep-linked task the board never loaded — filtered out, or on a page still draining.
   * `null` once it is on the board, which is also what keeps the panel from re-requesting a
   * row it can already read out of `tasks`.
   */
  const fetchSelectedTask = useMemo(() => {
    if (!activeId || !selectedTaskId || loading) return null;
    if (tasksRef.current.some((task) => task.id === selectedTaskId)) return null;
    return (signal: AbortSignal): Promise<TaskDto> =>
      api.get<TaskDto>(`/workspaces/${activeId}/tasks/${selectedTaskId}`, { signal });
  }, [activeId, selectedTaskId, loading, tasksRef]);

  /**
   * Whether the last failure was the server saying the row is not there.
   *
   * `useApiResource` reports one message per failure, but the panel has to tell a task that is
   * gone (nothing to retry) from a load that broke (worth another go), and only the caught
   * error knows which. Never read while `fetchedTaskError` is `null`, so it does not need
   * clearing on success — the two are written in the same pass.
   */
  const [selectedTaskGone, setSelectedTaskGone] = useState(false);

  const {
    data: fetchedTask,
    error: fetchedTaskError,
    reload: retryPanelTask,
  } = useApiResource<TaskDto | null>(fetchSelectedTask, null, tErrors('taskLoad'), {
    onError: (caught) => setSelectedTaskGone(apiStatus(caught) === 404),
  });

  useEffect(() => {
    if (!fetchedTask) return;
    setTasks((current) =>
      current.some((item) => item.id === fetchedTask.id) ? current : [...current, fetchedTask],
    );
  }, [fetchedTask]);

  // No request in flight means no failure to report — a task that is already on the board
  // must not inherit the error left over from the last one that was not.
  const panelError = fetchSelectedTask && !selectedTaskGone ? fetchedTaskError : null;

  /**
   * Still on its way. Deliberately keyed on the row reaching `tasks` rather than on the
   * hook's own `loading`: the fetch resolving and the row being merged are two commits, and
   * the panel would otherwise spend the one in between saying the task no longer exists.
   */
  const panelLoading =
    fetchSelectedTask !== null &&
    fetchedTaskError === null &&
    !tasks.some((task) => task.id === selectedTaskId);

  return {
    board,
    columns,
    tasks,
    members,
    labels,
    loading,
    tasksSyncing,
    error,
    panelLoading,
    panelError,
    retryPanelTask,
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
    setMetaRefreshKey,
  };
}
