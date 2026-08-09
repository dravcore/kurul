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

  const reloadTasks = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!activeId) return;
      const nextTasks = await fetchAllBoardTasks(activeId, boardId, filters, { signal });
      if (signal?.aborted) return;
      setTasks(nextTasks);
    },
    [activeId, boardId, filters],
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
      try {
        if (isInitial) {
          await reload(controller.signal);
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
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [activeId, boardId, filters, reload, reloadTasks, t]);

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
