'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  BoardDto,
  ColumnDto,
  LabelDto,
  TaskDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import type { BoardTaskFilters } from '@/lib/task-query';
import { useBoardCaches } from './use-board-caches';
import { useBoardFetch } from './use-board-fetch';
import { useBoardLoad } from './use-board-load';
import { useBoardPanelTask } from './use-board-panel-task';

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
  /**
   * The last board load failed with 404/403: the board is not there, or not ours. There is
   * nothing to retry, so the caller must offer a way out instead of a `Try again` button.
   */
  unavailable: boolean;
  /**
   * Runs the initial load again from a failed state: clears the error, puts the skeleton back
   * and re-enters the load effect. Distinct from `reload`, which is the realtime resync path
   * and must keep refreshing a *painted* board silently, without a skeleton — though it clears
   * the same error/unavailable flags on success, so a resync that lands behind a dead-end
   * screen heals it too.
   */
  retry: () => void;
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
  /** The realtime resync path. Clears `error`/`unavailable` on success; leaves them on failure. */
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

/**
 * Everything the board reads, composed from four hooks that each own one concern:
 * `useBoardCaches` holds the lists, `useBoardFetch` performs the reads, `useBoardLoad` decides
 * what the screen says while and after they run, and `useBoardPanelTask` covers the one row a
 * deep link asks for that the board itself never loaded.
 *
 * This file is the seam between them and the caller's single object. It keeps only the two
 * things that belong to no single layer: `metaRefreshKey`, which the realtime layer bumps to
 * make the open panel re-read its comments, and `reload` (below), which is a fetch and a
 * status change at once.
 */
export function useBoardData(
  boardId: string,
  filters: BoardTaskFilters,
  selectedTaskId: string | null = null,
): UseBoardDataResult {
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);

  const caches = useBoardCaches();
  const { setBoard, setColumns, setTasks, setMembers, setLabels } = caches;

  const { tasksSyncing, reloadBoardMeta, drainTasks, reloadTasks } = useBoardFetch({
    boardId,
    filters,
    setBoard,
    setColumns,
    setTasks,
    setMembers,
    setLabels,
  });

  const { loading, error, unavailable, retry, clearFailure, setLoading, setError } = useBoardLoad({
    boardId,
    filters,
    reloadBoardMeta,
    drainTasks,
    reloadTasks,
  });

  /**
   * The realtime resync path: refreshes a board that is already on screen, silently, without
   * the skeleton or the `loadedBoardIdRef` reset `retry` does.
   *
   * A successful resync doubles as a heal path: the socket keeps running behind an error
   * screen (it is wired above the `error` check in `BoardView`), so a board that failed to
   * load and then recovers on its own — the API came back, the join happened to land after
   * all — must not sit on the dead-end screen once fresher data has actually arrived. Clearing
   * `error`/`unavailable` here, after the fetches resolve, is what lets that happen. A *failed*
   * resync must not touch either: `clearFailure` never runs on failure, so an existing error is
   * left exactly as it was for the caller (who already swallows the rejection) to ask again.
   */
  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      await Promise.all([reloadBoardMeta(signal), reloadTasks(signal)]);
      if (signal?.aborted) return;
      clearFailure();
    },
    [reloadBoardMeta, reloadTasks, clearFailure],
  );

  const { panelLoading, panelError, retryPanelTask } = useBoardPanelTask({
    selectedTaskId,
    tasks: caches.tasks,
    loading,
    setTasks,
  });

  return {
    board: caches.board,
    columns: caches.columns,
    tasks: caches.tasks,
    members: caches.members,
    labels: caches.labels,
    loading,
    tasksSyncing,
    error,
    unavailable,
    retry,
    panelLoading,
    panelError,
    retryPanelTask,
    metaRefreshKey,
    columnsRef: caches.columnsRef,
    tasksRef: caches.tasksRef,
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
