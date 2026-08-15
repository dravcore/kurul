import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import { columnDroppableId } from '@/components/board/board-column';
import { useBoardTaskDnd, type TaskMovePayload } from './use-board-task-dnd';

const BOARD_ID = 'board-1';
const COLUMN_A = 'column-a';
const COLUMN_B = 'column-b';

function task(id: string, columnId: string, position: number): TaskDto {
  return {
    id,
    boardId: BOARD_ID,
    columnId,
    title: `Task ${id}`,
    description: null,
    priority: Priority.MEDIUM,
    position,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  };
}

function dragStart(activeId: string): DragStartEvent {
  return { active: { id: activeId } } as unknown as DragStartEvent;
}

function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

function setup(tasks: TaskDto[], canMutate = true) {
  const onMove = vi.fn<(payload: TaskMovePayload) => Promise<void>>().mockResolvedValue(undefined);
  const rendered = renderHook(() => useBoardTaskDnd(tasks, canMutate, onMove));
  return { onMove, rendered };
}

describe('useBoardTaskDnd', () => {
  it('exposes the dragged task as activeTask during a drag', () => {
    const tasks = [task('a', COLUMN_A, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragStart(dragStart('a')));

    expect(rendered.result.current.activeTask?.id).toBe('a');

    act(() => rendered.result.current.onDragCancel());

    expect(rendered.result.current.activeTask).toBeNull();
  });

  it('drops into an empty column with open neighbors at the base position', () => {
    const tasks = [task('a', COLUMN_A, 1000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', columnDroppableId(COLUMN_B))));

    expect(onMove).toHaveBeenCalledTimes(1);
    const payload = onMove.mock.calls[0]![0];
    expect(payload).toMatchObject({
      taskId: 'a',
      columnId: COLUMN_B,
      beforeTaskId: null,
      afterTaskId: null,
    });
    expect(payload.nextTasks.find((item) => item.id === 'a')).toMatchObject({
      columnId: COLUMN_B,
      position: 1000,
    });
  });

  it('moving down within a column inserts after the hovered card', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000), task('c', COLUMN_A, 3000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'b')));

    expect(onMove).toHaveBeenCalledTimes(1);
    const payload = onMove.mock.calls[0]![0];
    expect(payload).toMatchObject({
      taskId: 'a',
      columnId: COLUMN_A,
      beforeTaskId: 'b',
      afterTaskId: 'c',
    });
    const moved = payload.nextTasks.find((item) => item.id === 'a')!;
    expect(moved.position).toBeGreaterThan(2000);
    expect(moved.position).toBeLessThan(3000);
  });

  it('moving up within a column inserts before the hovered card', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000), task('c', COLUMN_A, 3000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('c', 'b')));

    expect(onMove).toHaveBeenCalledTimes(1);
    const payload = onMove.mock.calls[0]![0];
    expect(payload).toMatchObject({
      taskId: 'c',
      columnId: COLUMN_A,
      beforeTaskId: 'a',
      afterTaskId: 'b',
    });
    const moved = payload.nextTasks.find((item) => item.id === 'c')!;
    expect(moved.position).toBeGreaterThan(1000);
    expect(moved.position).toBeLessThan(2000);
  });

  it('dropping onto a card in another column inserts before that card', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000), task('e', COLUMN_B, 2000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'd')));

    expect(onMove).toHaveBeenCalledTimes(1);
    const payload = onMove.mock.calls[0]![0];
    expect(payload).toMatchObject({
      taskId: 'a',
      columnId: COLUMN_B,
      beforeTaskId: null,
      afterTaskId: 'd',
    });
    const moved = payload.nextTasks.find((item) => item.id === 'a')!;
    expect(moved.columnId).toBe(COLUMN_B);
    expect(moved.position).toBeLessThan(1000);
  });

  it('does nothing when the card is dropped on itself', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'a')));

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does nothing when the drop has no target', () => {
    const tasks = [task('a', COLUMN_A, 1000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', null)));

    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores drags entirely when the user cannot mutate tasks', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000)];
    const { onMove, rendered } = setup(tasks, false);

    act(() => rendered.result.current.onDragStart(dragStart('a')));
    expect(rendered.result.current.activeTask).toBeNull();

    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'b')));
    expect(onMove).not.toHaveBeenCalled();
  });

  // Previously failed: applyMove compared raw array indices instead of position.
  it('moving down still works when the tasks array is not position-sorted', () => {
    const tasks = [task('b', COLUMN_A, 2000), task('a', COLUMN_A, 1000)];
    const { onMove, rendered } = setup(tasks);

    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'b')));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0]).toMatchObject({
      taskId: 'a',
      columnId: COLUMN_A,
      beforeTaskId: 'b',
      afterTaskId: null,
    });
  });
});
