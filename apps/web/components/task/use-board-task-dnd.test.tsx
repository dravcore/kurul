import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Priority, type TaskDto } from '@kurul/shared-types';
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

function dragOver(activeId: string, overId: string | null): DragOverEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragOverEvent;
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

  it('reports no drop indicator until a card is over something', () => {
    const tasks = [task('a', COLUMN_A, 1000)];
    const { rendered } = setup(tasks);

    expect(rendered.result.current.dropIndicator).toBeNull();

    act(() => rendered.result.current.onDragStart(dragStart('a')));

    expect(rendered.result.current.dropIndicator).toBeNull();
  });

  it('marks the hovered card’s slot in another column', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000), task('e', COLUMN_B, 2000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'd')));
    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_B, index: 0 });

    act(() => rendered.result.current.onDragOver(dragOver('a', 'e')));
    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_B, index: 1 });
  });

  it('marks the end of a column hovered by its empty area', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000), task('e', COLUMN_B, 2000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', columnDroppableId(COLUMN_B))));

    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_B, index: 2 });
  });

  it('marks an empty column at its first slot', () => {
    const tasks = [task('a', COLUMN_A, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', columnDroppableId(COLUMN_B))));

    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_B, index: 0 });
  });

  /**
   * Within one column the index is the hovered card's own slot in the list the column still
   * renders, in both directions of travel: @dnd-kit has already translated that card out of the
   * slot and the dragged card into it, so that slot is where the drop lands and its leading edge
   * is where the rail belongs. It is deliberately not the index the drop produces in the list
   * without the dragged card, which for a downward move is one further on.
   */
  it('marks the slot the hovered card vacates when the move is down its own column', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000), task('c', COLUMN_A, 3000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'b')));
    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 1 });

    act(() => rendered.result.current.onDragOver(dragOver('a', 'c')));
    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 2 });
  });

  it('marks the same slot when the move is up its own column', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000), task('c', COLUMN_A, 3000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('c', 'b')));

    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 1 });
  });

  it('marks the card’s own slot while it is over itself', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'a')));

    // @dnd-kit reports the dragged card as its own target for as long as it has not travelled
    // past a neighbour, and the slot it would land in is the one it is already in.
    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 0 });
  });

  it('marks the end of its own column when the empty area under it is hovered', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('b', COLUMN_A, 2000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', columnDroppableId(COLUMN_A))));

    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 2 });
  });

  it('orders the slots by position rather than by array order', () => {
    const tasks = [task('b', COLUMN_A, 2000), task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('d', 'b')));

    expect(rendered.result.current.dropIndicator).toEqual({ columnId: COLUMN_A, index: 1 });
  });

  it('drops the indicator when the pointer leaves every column', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'd')));
    act(() => rendered.result.current.onDragOver(dragOver('a', null)));

    expect(rendered.result.current.dropIndicator).toBeNull();
  });

  it('drops the indicator when the drag ends', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'd')));
    act(() => rendered.result.current.onDragEnd(dragEnd('a', 'd')));

    expect(rendered.result.current.dropIndicator).toBeNull();
  });

  it('drops the indicator when the drag is cancelled', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000)];
    const { rendered } = setup(tasks);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'd')));
    act(() => rendered.result.current.onDragCancel());

    expect(rendered.result.current.dropIndicator).toBeNull();
  });

  it('shows no indicator at all for a role that cannot move tasks', () => {
    const tasks = [task('a', COLUMN_A, 1000), task('d', COLUMN_B, 1000)];
    const { rendered } = setup(tasks, false);

    act(() => rendered.result.current.onDragOver(dragOver('a', 'd')));

    expect(rendered.result.current.dropIndicator).toBeNull();
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

/**
 * A touch also raises pointer events, so one `PointerSensor` cannot hold both a distance for the
 * mouse and a delay for the finger: whichever constraint is on it decides for both devices. The
 * board splits them, which is what lets the card body keep scrolling under a thumb while the
 * grip still lifts a card after a long press.
 */
describe('useBoardTaskDnd sensors', () => {
  function sensors() {
    const { rendered } = setup([task('a', COLUMN_A, 1000)]);
    return rendered.result.current.sensors;
  }

  /** @dnd-kit types the descriptor's options as the base `SensorOptions`, which declares none. */
  function constraintOf(index: number): unknown {
    const options = sensors()[index]!.options as { activationConstraint?: unknown };
    return options.activationConstraint;
  }

  it('drives the mouse, the finger and the keyboard from three separate sensors', () => {
    expect(sensors().map((descriptor) => descriptor.sensor)).toEqual([
      MouseSensor,
      TouchSensor,
      KeyboardSensor,
    ]);
  });

  it('starts a mouse drag after 6px and with no timer of any kind', () => {
    expect(constraintOf(0)).toEqual({ distance: 6 });
  });

  it('starts a touch drag on a 250ms press held inside 5px', () => {
    expect(constraintOf(1)).toEqual({ delay: 250, tolerance: 5 });
  });

  it('leaves the keyboard sensor unconstrained', () => {
    expect(constraintOf(2)).toBeUndefined();
  });
});
