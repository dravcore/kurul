'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DropAnimation,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { ColumnDto, TaskDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { TaskDragPreview } from '@/components/task/sortable-task-card';
import type { BoardTaskDndController } from '@/components/task/use-board-task-dnd';
import { BoardColumn } from './board-column';

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

interface BoardCanvasProps {
  boardId: string;
  columns: ColumnDto[];
  tasksByColumn: Map<string, TaskDto[]>;
  selectedTaskId: string | null;
  canMutateColumns: boolean;
  canMutateTasks: boolean;
  /** Once the stagger has played, columns render without the entrance animation. */
  entranceDone: boolean;
  dnd: BoardTaskDndController;
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  };
  onCreateColumn: () => void;
  onOpenColumnSettings: (column: ColumnDto) => void;
  onDeleteColumn: (column: ColumnDto) => void;
  onMoveColumn: (column: ColumnDto, direction: -1 | 1) => void;
  onAddTask: (columnId: string) => void;
}

/** The scrollable column strip and everything drag and drop needs around it. */
export function BoardCanvas({
  boardId,
  columns,
  tasksByColumn,
  selectedTaskId,
  canMutateColumns,
  canMutateTasks,
  entranceDone,
  dnd,
  accessibility,
  onCreateColumn,
  onOpenColumnSettings,
  onDeleteColumn,
  onMoveColumn,
  onAddTask,
}: BoardCanvasProps): React.ReactElement {
  const t = useTranslations('app.board');

  return (
    <DndContext
      accessibility={accessibility}
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((column, index) => (
          <BoardColumn
            key={column.id}
            column={column}
            tasks={tasksByColumn.get(column.id) ?? []}
            boardId={boardId}
            selectedTaskId={selectedTaskId}
            canMutateColumns={canMutateColumns}
            canMutateTasks={canMutateTasks}
            canMoveLeft={index > 0}
            canMoveRight={index < columns.length - 1}
            onOpenSettings={() => onOpenColumnSettings(column)}
            onDelete={() => onDeleteColumn(column)}
            onMoveLeft={() => onMoveColumn(column, -1)}
            onMoveRight={() => onMoveColumn(column, 1)}
            onAddTask={() => onAddTask(column.id)}
            className={entranceDone ? undefined : 'board-column-enter'}
            style={entranceDone ? undefined : ({ '--stagger-index': index } as React.CSSProperties)}
          />
        ))}
        {canMutateColumns ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-[var(--column-width)] min-w-[280px] shrink-0"
            onClick={onCreateColumn}
          >
            <Plus />
            {t('column.createAction')}
          </Button>
        ) : null}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {dnd.activeTask ? <TaskDragPreview task={dnd.activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
