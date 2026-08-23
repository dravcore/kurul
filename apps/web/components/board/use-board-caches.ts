'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  BoardDto,
  ColumnDto,
  LabelDto,
  TaskDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';

export type UseBoardCachesResult = {
  board: BoardDto | null;
  columns: ColumnDto[];
  tasks: TaskDto[];
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  columnsRef: React.MutableRefObject<ColumnDto[]>;
  tasksRef: React.MutableRefObject<TaskDto[]>;
  setBoard: Dispatch<SetStateAction<BoardDto | null>>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  setMembers: Dispatch<SetStateAction<WorkspaceMemberDto[]>>;
  setLabels: Dispatch<SetStateAction<LabelDto[]>>;
};

/**
 * The five lists a board is made of, plus the two refs that mirror them.
 *
 * Nothing here fetches. This is the cache the fetchers write into and the mutation, realtime
 * and dnd layers read back out, held in one place so that "what the board currently believes"
 * is a single hook rather than a preamble every other hook has to be handed.
 *
 * `columnsRef` and `tasksRef` exist because a write path needs the *latest* list from inside a
 * callback that was created several renders ago: an optimistic move rolling back, a socket
 * event asking whether it already knows a task. Reading state there would capture the value
 * from the render that made the closure. They are mirrors, never a second source of truth,
 * which is why they are only ever written from the effects below.
 */
export function useBoardCaches(): UseBoardCachesResult {
  const [board, setBoard] = useState<BoardDto | null>(null);
  const [columns, setColumns] = useState<ColumnDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberDto[]>([]);
  const [labels, setLabels] = useState<LabelDto[]>([]);

  const columnsRef = useRef<ColumnDto[]>([]);
  const tasksRef = useRef<TaskDto[]>([]);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  return {
    board,
    columns,
    tasks,
    members,
    labels,
    columnsRef,
    tasksRef,
    setBoard,
    setColumns,
    setTasks,
    setMembers,
    setLabels,
  };
}
