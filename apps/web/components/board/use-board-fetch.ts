'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  BoardDto,
  ColumnDto,
  LabelDto,
  TaskDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import { api } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';
import { fetchAllBoardTasks, type BoardTaskFilters } from '@/lib/task-query';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';

export type UseBoardFetchOptions = {
  boardId: string;
  filters: BoardTaskFilters;
  setBoard: Dispatch<SetStateAction<BoardDto | null>>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  setMembers: Dispatch<SetStateAction<WorkspaceMemberDto[]>>;
  setLabels: Dispatch<SetStateAction<LabelDto[]>>;
};

export type UseBoardFetchResult = {
  /** True while task pages are still draining behind an already-painted board. */
  tasksSyncing: boolean;
  /** The frame: board, columns, members, labels, in one round of requests. */
  reloadBoardMeta: (signal?: AbortSignal) => Promise<void>;
  /** The paged task read, with a hook for the caller that wants to paint on page 0. */
  drainTasks: (signal?: AbortSignal, onFirstPage?: () => void) => Promise<void>;
  reloadTasks: (signal?: AbortSignal) => Promise<void>;
};

/**
 * Every read the board makes, and nothing else: no loading flag, no error string, no retry.
 *
 * Splitting the reads out from the load state they used to sit beside is what makes the two
 * legible separately. A fetcher here either resolves or rejects; deciding what a rejection
 * means for the screen (skeleton, dead end, silent) belongs to `useBoardLoad`, and the
 * realtime resync in `useBoardData` composes these same two functions without any of it.
 */
export function useBoardFetch({
  boardId,
  filters,
  setBoard,
  setColumns,
  setTasks,
  setMembers,
  setLabels,
}: UseBoardFetchOptions): UseBoardFetchResult {
  const { activeId } = useWorkspaceContext();
  const [tasksSyncing, setTasksSyncing] = useState(false);

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
    [activeId, boardId, setBoard, setColumns, setMembers, setLabels],
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
    [activeId, boardId, filters, setTasks],
  );

  const reloadTasks = useCallback(
    (signal?: AbortSignal): Promise<void> => drainTasks(signal),
    [drainTasks],
  );

  return { tasksSyncing, reloadBoardMeta, drainTasks, reloadTasks };
}
