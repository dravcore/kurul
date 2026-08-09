'use client';

import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import { CreateTaskDialog } from '@/components/task/create-task-dialog';
import { DeleteTaskDialog } from '@/components/task/delete-task-dialog';
import { CreateColumnDialog } from './create-column-dialog';
import { DeleteColumnDialog } from './delete-column-dialog';
import { RenameColumnDialog } from './rename-column-dialog';
import type { BoardDialogsController } from './use-board-dialogs';

interface BoardDialogsProps {
  dialogs: BoardDialogsController;
  workspaceId: string;
  boardId: string;
  /** New columns append after the current last one. */
  lastColumnId?: string;
  onColumnCreated: (column: ColumnDto) => void;
  onColumnRenamed: (column: ColumnDto) => void;
  onColumnDeleted: (columnId: string) => void;
  onTaskCreated: (task: TaskDto) => void;
  onTaskDeleted: (taskId: string) => void;
}

/** Every board-level dialog in one place, driven by `useBoardDialogs`. */
export function BoardDialogs({
  dialogs,
  workspaceId,
  boardId,
  lastColumnId,
  onColumnCreated,
  onColumnRenamed,
  onColumnDeleted,
  onTaskCreated,
  onTaskDeleted,
}: BoardDialogsProps): React.ReactElement {
  return (
    <>
      <CreateColumnDialog
        open={dialogs.createColumnOpen}
        onOpenChange={dialogs.setCreateColumnOpen}
        workspaceId={workspaceId}
        boardId={boardId}
        afterColumnId={lastColumnId}
        onCreated={onColumnCreated}
      />
      <RenameColumnDialog
        open={dialogs.renameColumn !== null}
        onOpenChange={(open) => {
          if (!open) dialogs.closeRenameColumn();
        }}
        workspaceId={workspaceId}
        column={dialogs.renameColumn}
        onRenamed={onColumnRenamed}
      />
      <DeleteColumnDialog
        open={dialogs.deleteColumn !== null}
        onOpenChange={(open) => {
          if (!open) dialogs.closeDeleteColumn();
        }}
        workspaceId={workspaceId}
        column={dialogs.deleteColumn}
        onDeleted={onColumnDeleted}
      />
      <CreateTaskDialog
        open={dialogs.createTaskColumnId !== null}
        onOpenChange={(open) => {
          if (!open) dialogs.closeCreateTask();
        }}
        workspaceId={workspaceId}
        boardId={boardId}
        columnId={dialogs.createTaskColumnId ?? ''}
        onCreated={onTaskCreated}
      />
      <DeleteTaskDialog
        open={dialogs.deleteTask !== null}
        onOpenChange={(open) => {
          if (!open) dialogs.closeDeleteTask();
        }}
        workspaceId={workspaceId}
        task={dialogs.deleteTask}
        onDeleted={onTaskDeleted}
      />
    </>
  );
}
