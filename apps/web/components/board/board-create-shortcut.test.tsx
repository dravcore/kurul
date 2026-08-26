import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { closestCorners } from '@dnd-kit/core';
import { NextIntlClientProvider } from 'next-intl';
import { ColumnCategory, type ColumnDto, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import type { BoardTaskDndController } from '@/components/task/use-board-task-dnd';
import { BoardCanvas } from './board-canvas';

/**
 * The `c` shortcut end to end: a real canvas, real columns and the real composer, because what
 * the shortcut has to get right is where focus lands and what survives the press. The prop-level
 * half lives in `board-canvas.test.tsx`, which stubs the column out.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const dnd: BoardTaskDndController = {
  sensors: [],
  activeTask: null,
  dropIndicator: null,
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragEnd: vi.fn(),
  onDragCancel: vi.fn(),
  cancelDrag: vi.fn(),
  isDragging: false,
  collisionDetection: closestCorners,
};

function column(id: string, name: string, position: number): ColumnDto {
  return {
    id,
    boardId: BOARD_ID,
    name,
    position,
    color: null,
    category: ColumnCategory.UNSTARTED,
    taskCount: 0,
  };
}

function renderBoard(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardCanvas
        boardId={BOARD_ID}
        workspaceId={WORKSPACE_ID}
        columns={[column('col-1', 'Backlog', 1), column('col-2', 'In progress', 2)]}
        tasksByColumn={new Map<string, TaskDto[]>()}
        selectedTaskId={null}
        taskSignals={new Map()}
        canMutateColumns={false}
        canMutateTasks
        entranceDone
        dnd={dnd}
        accessibility={{
          announcements: {
            onDragStart: () => undefined,
            onDragOver: () => undefined,
            onDragEnd: () => undefined,
            onDragCancel: () => undefined,
          },
          screenReaderInstructions: { draggable: '' },
        }}
        onCreateColumn={vi.fn()}
        onOpenColumnSettings={vi.fn()}
        onDeleteColumn={vi.fn()}
        onMoveColumn={vi.fn()}
        onTaskCreated={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function pressC(): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }),
    );
  });
}

const columnBody = (name: string): HTMLElement => screen.getByRole('region', { name });

const fieldIn = (name: string): HTMLInputElement =>
  within(columnBody(name)).getByRole('textbox', {
    name: messages.app.board.column.composerPlaceholder,
  }) as HTMLInputElement;

const addTaskIn = (name: string): HTMLElement =>
  within(columnBody(name)).getByRole('button', { name: messages.app.board.task.createAction });

afterEach(() => {
  cleanup();
});

describe('the c shortcut on a board', () => {
  it('opens and focuses the first column composer when none is open', () => {
    renderBoard();

    pressC();

    expect(fieldIn('Backlog')).toBe(document.activeElement);
    expect(
      within(columnBody('In progress')).queryByRole('textbox', {
        name: messages.app.board.column.composerPlaceholder,
      }),
    ).toBeNull();
  });

  it('focuses the composer already open elsewhere and keeps what is typed in it', () => {
    renderBoard();

    fireEvent.click(addTaskIn('In progress'));
    fireEvent.change(fieldIn('In progress'), { target: { value: 'Half a title' } });
    // A real `blur()` rather than `fireEvent.blur`, which fires the event without moving focus:
    // the point of the press below is that focus comes back from somewhere else.
    act(() => fieldIn('In progress').blur());
    expect(document.activeElement).toBe(document.body);

    pressC();

    expect(fieldIn('In progress')).toBe(document.activeElement);
    expect(fieldIn('In progress').value).toBe('Half a title');
    expect(addTaskIn('Backlog')).toBeDefined();
  });

  it('focuses the same field again on a second press', () => {
    renderBoard();

    pressC();
    fireEvent.change(fieldIn('Backlog'), { target: { value: 'Still here' } });
    act(() => fieldIn('Backlog').blur());
    expect(document.activeElement).toBe(document.body);

    pressC();

    expect(fieldIn('Backlog')).toBe(document.activeElement);
    expect(fieldIn('Backlog').value).toBe('Still here');
  });
});
