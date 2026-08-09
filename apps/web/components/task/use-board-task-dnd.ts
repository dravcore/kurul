'use client';

import { useMemo, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { TaskDto } from '@kurultay/shared-types';
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
        tasks.findIndex((task) => task.id === taskId) <
          tasks.findIndex((task) => task.id === overTaskId)
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

export function useBoardTaskDnd(
  tasks: TaskDto[],
  canMutate: boolean,
  onMove: (payload: TaskMovePayload) => Promise<void>,
): {
  sensors: ReturnType<typeof useSensors>;
  activeTask: TaskDto | null;
  announcement: string;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  collisionDetection: typeof closestCorners;
} {
  const [activeTask, setActiveTask] = useState<TaskDto | null>(null);
  const [announcement, setAnnouncement] = useState('');

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

  function onDragCancel(): void {
    setActiveTask(null);
  }

  function onDragEnd(event: DragEndEvent): void {
    setActiveTask(null);
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

    setAnnouncement(`Moved ${moving.title}`);
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
    announcement,
    onDragStart,
    onDragEnd,
    onDragCancel,
    collisionDetection: closestCorners,
  };
}
