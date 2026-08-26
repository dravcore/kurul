'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { ColumnDto, TaskDto } from '@kurul/shared-types';

/**
 * Which board dialog is open, and what it is acting on. Column and task dialogs are keyed
 * on the subject rather than a boolean so the dialog keeps rendering its target while it
 * animates closed.
 */
export type BoardDialogsController = {
  createColumnOpen: boolean;
  setCreateColumnOpen: Dispatch<SetStateAction<boolean>>;
  columnSettings: ColumnDto | null;
  deleteColumn: ColumnDto | null;
  deleteTask: TaskDto | null;
  openCreateColumn: () => void;
  openColumnSettings: (column: ColumnDto) => void;
  closeColumnSettings: () => void;
  openDeleteColumn: (column: ColumnDto) => void;
  closeDeleteColumn: () => void;
  openDeleteTask: (task: TaskDto) => void;
  closeDeleteTask: () => void;
};

export function useBoardDialogs(): BoardDialogsController {
  const [createColumnOpen, setCreateColumnOpen] = useState(false);
  const [columnSettings, setColumnSettings] = useState<ColumnDto | null>(null);
  const [deleteColumn, setDeleteColumn] = useState<ColumnDto | null>(null);
  const [deleteTask, setDeleteTask] = useState<TaskDto | null>(null);

  const openCreateColumn = useCallback(() => setCreateColumnOpen(true), []);
  const openColumnSettings = useCallback((column: ColumnDto) => setColumnSettings(column), []);
  const closeColumnSettings = useCallback(() => setColumnSettings(null), []);
  const openDeleteColumn = useCallback((column: ColumnDto) => setDeleteColumn(column), []);
  const closeDeleteColumn = useCallback(() => setDeleteColumn(null), []);
  const openDeleteTask = useCallback((task: TaskDto) => setDeleteTask(task), []);
  const closeDeleteTask = useCallback(() => setDeleteTask(null), []);

  return useMemo(
    () => ({
      createColumnOpen,
      setCreateColumnOpen,
      columnSettings,
      deleteColumn,
      deleteTask,
      openCreateColumn,
      openColumnSettings,
      closeColumnSettings,
      openDeleteColumn,
      closeDeleteColumn,
      openDeleteTask,
      closeDeleteTask,
    }),
    [
      createColumnOpen,
      columnSettings,
      deleteColumn,
      deleteTask,
      openCreateColumn,
      openColumnSettings,
      closeColumnSettings,
      openDeleteColumn,
      closeDeleteColumn,
      openDeleteTask,
      closeDeleteTask,
    ],
  );
}
