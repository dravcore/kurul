'use client';

import { useMemo, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { TaskDto } from '@kurul/shared-types';
import { midpoint } from '@/lib/position';
import { parseColumnDroppableId } from '@/components/board/board-column';

export interface TaskMovePayload {
  taskId: string;
  columnId: string;
  beforeTaskId: string | null;
  afterTaskId: string | null;
  previousTasks: TaskDto[];
  nextTasks: TaskDto[];
}

function sortTasks(tasks: TaskDto[]): TaskDto[] {
  return [...tasks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Which slot of the column the drop lands in, counted in the list the column *renders* rather
 * than in the list the drop produces. The two differ by one for a downward move inside a single
 * column, and the rendered one is what the rail has to follow: within a column @dnd-kit has
 * already translated the hovered card out of its slot and the dragged card into it, so that slot
 * is the gap, whichever direction the card came from. Across columns nothing is translated and
 * the slot is simply the hovered card's own.
 */
function dropSlotIndex(
  tasks: TaskDto[],
  targetColumnId: string,
  overTaskId: string | null,
): number {
  const columnTasks = sortTasks(tasks.filter((task) => task.columnId === targetColumnId));
  const overIndex = overTaskId ? columnTasks.findIndex((task) => task.id === overTaskId) : -1;
  return overIndex >= 0 ? overIndex : columnTasks.length;
}

function applyMove(
  tasks: TaskDto[],
  taskId: string,
  targetColumnId: string,
  overTaskId: string | null,
): { nextTasks: TaskDto[]; beforeTaskId: string | null; afterTaskId: string | null } | null {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return null;

  const without = tasks.filter((task) => task.id !== taskId);
  const columnTasks = sortTasks(without.filter((task) => task.columnId === targetColumnId));

  let insertionIndex = columnTasks.length;
  if (overTaskId) {
    const overIndex = columnTasks.findIndex((task) => task.id === overTaskId);
    if (overIndex >= 0) {
      // If moving down within the same column, insert after the over item's slot
      // in the pre-remove list sense: place at overIndex (before that item).
      insertionIndex = overIndex;
      if (
        moving.columnId === targetColumnId &&
        moving.position < columnTasks[overIndex]!.position
      ) {
        insertionIndex = overIndex + 1;
      }
    }
  }

  const before = columnTasks[insertionIndex - 1] ?? null;
  const after = columnTasks[insertionIndex] ?? null;
  const position = midpoint(before?.position ?? null, after?.position ?? null);
  const updated: TaskDto = { ...moving, columnId: targetColumnId, position };
  const nextColumn = [...columnTasks];
  nextColumn.splice(insertionIndex, 0, updated);

  const nextTasks = [...without.filter((task) => task.columnId !== targetColumnId), ...nextColumn];

  return {
    nextTasks,
    beforeTaskId: before?.id ?? null,
    afterTaskId: after?.id ?? null,
  };
}

/**
 * Where the card in the air would land: one column, and one slot in the list it renders.
 *
 * Deliberately not exported: `board-canvas.tsx` reads it as
 * `BoardTaskDndController['dropIndicator']` and the column takes the slot as a bare number, so
 * an export here would be a name nothing imports.
 */
interface DropIndicator {
  columnId: string;
  index: number;
}

export interface BoardTaskDndController {
  sensors: ReturnType<typeof useSensors>;
  activeTask: TaskDto | null;
  dropIndicator: DropIndicator | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  cancelDrag: () => void;
  isDragging: boolean;
  collisionDetection: typeof closestCorners;
}

export function useBoardTaskDnd(
  tasks: TaskDto[],
  canMutate: boolean,
  onMove: (payload: TaskMovePayload) => Promise<void>,
): BoardTaskDndController {
  const [activeTask, setActiveTask] = useState<TaskDto | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  function onDragStart(event: DragStartEvent): void {
    if (!canMutate) return;
    const task = taskById.get(String(event.active.id)) ?? null;
    setActiveTask(task);
  }

  /**
   * The visible half of what the live region already says.
   *
   * It cannot be `useDroppable`'s `isOver`: a keyboard drag moves the lifted card into the
   * target column's `SortableContext`, so @dnd-kit reports one of that column's *cards* as the
   * target and the column's own droppable never turns over. `over` is the one signal both
   * pointer devices raise.
   */
  function onDragOver(event: DragOverEvent): void {
    if (!canMutate) return;
    const { active, over } = event;
    const moving = taskById.get(String(active.id));
    if (!moving || !over) {
      setDropIndicator(null);
      return;
    }

    const overId = String(over.id);
    const columnFromOver = parseColumnDroppableId(overId);
    const overTask = columnFromOver ? null : (taskById.get(overId) ?? null);
    const targetColumnId = columnFromOver ?? overTask?.columnId;
    if (!targetColumnId) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator({
      columnId: targetColumnId,
      index: dropSlotIndex(tasks, targetColumnId, overTask?.id ?? null),
    });
  }

  function onDragCancel(): void {
    setActiveTask(null);
    setDropIndicator(null);
  }

  function onDragEnd(event: DragEndEvent): void {
    setActiveTask(null);
    setDropIndicator(null);
    if (!canMutate) return;
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    const columnFromOver = parseColumnDroppableId(overId);
    const overTask = columnFromOver ? null : (taskById.get(overId) ?? null);
    const targetColumnId = columnFromOver ?? overTask?.columnId;
    if (!targetColumnId) return;

    const moving = taskById.get(taskId);
    if (!moving) return;
    if (moving.columnId === targetColumnId && overTask?.id === taskId) return;

    const applied = applyMove(tasks, taskId, targetColumnId, overTask?.id ?? null);
    if (!applied) return;
    if (
      applied.nextTasks.find((task) => task.id === taskId)?.columnId === moving.columnId &&
      applied.nextTasks.find((task) => task.id === taskId)?.position === moving.position
    ) {
      return;
    }

    // The move itself is announced by the DndContext accessibility config, which owns the
    // only live region on the board.
    void onMove({
      taskId,
      columnId: targetColumnId,
      beforeTaskId: applied.beforeTaskId,
      afterTaskId: applied.afterTaskId,
      previousTasks: tasks,
      nextTasks: applied.nextTasks,
    });
  }

  return {
    sensors,
    activeTask,
    dropIndicator,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    cancelDrag: onDragCancel,
    isDragging: activeTask !== null,
    collisionDetection: closestCorners,
  };
}
