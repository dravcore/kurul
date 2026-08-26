'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
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
import { useCreateTaskShortcut } from './use-create-task-shortcut';
import { useReducedMotion } from './use-reduced-motion';

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

interface BoardCanvasProps {
  boardId: string;
  workspaceId: string | null;
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
  onTaskCreated: (task: TaskDto) => void;
}

/** The scrollable column strip and everything drag and drop needs around it. */
export function BoardCanvas({
  boardId,
  workspaceId,
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
  onTaskCreated,
}: BoardCanvasProps): React.ReactElement {
  const t = useTranslations('app.board');
  const reducedMotion = useReducedMotion();
  const [composerColumnId, setComposerColumnId] = useState<string | null>(null);

  // Every column takes tasks from the same role check, so the first column is the first one a
  // task can be added to.
  const firstColumnId = columns[0]?.id ?? null;
  const openFirstComposer = useCallback(() => setComposerColumnId(firstColumnId), [firstColumnId]);
  const canAddTask = canMutateTasks && workspaceId !== null && firstColumnId !== null;
  useCreateTaskShortcut(canAddTask ? openFirstComposer : null);

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
            workspaceId={workspaceId}
            composerOpen={composerColumnId === column.id}
            onComposerOpenChange={(open) => setComposerColumnId(open ? column.id : null)}
            onTaskCreated={onTaskCreated}
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
      {/* @dnd-kit flies the overlay back to the drop position with `node.animate()`, a Web
          Animations API call the reduced-motion block in `app/globals.css` cannot reach: the
          browser pass measured a 250ms `translate3d` keyframe pair still running under
          `prefers-reduced-motion: reduce`. `null` is @dnd-kit's own way to say the overlay
          simply goes away, which is the movement-free landing docs/design.md §5 asks for. */}
      <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation}>
        {dnd.activeTask ? <TaskDragPreview task={dnd.activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
