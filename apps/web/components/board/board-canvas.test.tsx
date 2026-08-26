import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { closestCorners, type DropAnimation } from '@dnd-kit/core';
import { NextIntlClientProvider } from 'next-intl';
import { ColumnCategory, type ColumnDto, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import type { BoardTaskDndController } from '@/components/task/use-board-task-dnd';
import { BoardCanvas } from './board-canvas';
import type { BoardColumn } from './board-column';

type ColumnProps = Parameters<typeof BoardColumn>[0];

/**
 * @dnd-kit flies the drag overlay back to the drop position with `node.animate()`, which no
 * media query can reach, so the reduced-motion answer for that one landing is a prop rather than
 * CSS: `dropAnimation={null}`. `useReducedMotion` is tested on its own and the CSS twins are
 * resolved in app/globals-css-layers.test.ts, but neither can see whether the two are still
 * wired together here. This file renders the canvas against a stubbed `matchMedia` and reads the
 * prop `DragOverlay` was actually handed.
 */
const overlay = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    // The context and the columns are stubbed out because a drag is not what is under test:
    // what is, is the single prop below.
    DndContext: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    DragOverlay: (props: { dropAnimation?: DropAnimation | null }) => {
      overlay.props(props);
      return null;
    },
  };
});

// Recorded rather than spied on: `vi.restoreAllMocks()` below would strip a `vi.fn`'s
// implementation, and this stub has to keep rendering across every test in the file.
const rendered = vi.hoisted(() => ({ columns: [] as unknown[] }));

vi.mock('./board-column', () => ({
  BoardColumn: (props: unknown) => {
    rendered.columns.push(props);
    return <div data-testid="board-column" />;
  },
}));

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

function column(id: string, position: number): ColumnDto {
  return {
    id,
    boardId: BOARD_ID,
    name: `Column ${id}`,
    position,
    color: null,
    category: ColumnCategory.UNSTARTED,
    taskCount: 0,
  };
}

/** The props the stubbed column was last rendered with, by column id. */
function lastColumnProps(id: string): ColumnProps {
  const props = (rendered.columns as ColumnProps[]).filter((entry) => entry.column.id === id);
  const last = props.at(-1);
  if (!last) throw new Error(`column ${id} was not rendered`);
  return last;
}

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const dnd: BoardTaskDndController = {
  sensors: [],
  activeTask: null,
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  onDragCancel: vi.fn(),
  cancelDrag: vi.fn(),
  isDragging: false,
  collisionDetection: closestCorners,
};

function renderCanvas(
  options: { columns?: ColumnDto[]; canMutateTasks?: boolean; workspaceId?: string | null } = {},
): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardCanvas
        boardId={BOARD_ID}
        workspaceId={options.workspaceId === undefined ? WORKSPACE_ID : options.workspaceId}
        columns={options.columns ?? ([] as ColumnDto[])}
        tasksByColumn={new Map<string, TaskDto[]>()}
        selectedTaskId={null}
        canMutateColumns={false}
        canMutateTasks={options.canMutateTasks ?? false}
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

/** The `dropAnimation` of the most recent render, once the preference effect has settled. */
function lastDropAnimation(): DropAnimation | null | undefined {
  const call = overlay.props.mock.calls.at(-1);
  if (call === undefined) throw new Error('DragOverlay was not rendered');
  return (call[0] as { dropAnimation?: DropAnimation | null }).dropAnimation;
}

afterEach(() => {
  cleanup();
  overlay.props.mockClear();
  rendered.columns.length = 0;
  // jsdom ships no `matchMedia`, and the hook treats that absence as its own case: putting the
  // property back would leave the next test reading this one's stub.
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

describe('BoardCanvas drop animation', () => {
  it('hands DragOverlay no drop animation when reduced motion is asked for', async () => {
    stubMatchMedia(true);
    renderCanvas();

    await waitFor(() => expect(lastDropAnimation()).toBeNull());
  });

  it('keeps the drop animation when nothing is asked for', async () => {
    stubMatchMedia(false);
    renderCanvas();

    await waitFor(() => expect(lastDropAnimation()).toBeTruthy());
    expect(lastDropAnimation()).toHaveProperty('sideEffects');
  });

  it('keeps the drop animation where matchMedia does not exist at all', () => {
    renderCanvas();

    expect(lastDropAnimation()).toBeTruthy();
  });
});

describe('BoardCanvas create shortcut', () => {
  function pressC(): void {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }),
    );
  }

  it('opens the composer of the first column a task can be added to', () => {
    renderCanvas({ columns: [column('col-1', 1), column('col-2', 2)], canMutateTasks: true });

    expect(lastColumnProps('col-1').composerOpen).toBe(false);

    act(() => pressC());

    expect(lastColumnProps('col-1').composerOpen).toBe(true);
    expect(lastColumnProps('col-2').composerOpen).toBe(false);
  });

  it('closes the composer again when the column asks it to', () => {
    renderCanvas({ columns: [column('col-1', 1)], canMutateTasks: true });

    act(() => pressC());
    act(() => lastColumnProps('col-1').onComposerOpenChange(false));

    expect(lastColumnProps('col-1').composerOpen).toBe(false);
  });

  it('leaves an open composer where it is and bumps its focus nonce instead', () => {
    renderCanvas({ columns: [column('col-1', 1), column('col-2', 2)], canMutateTasks: true });

    act(() => lastColumnProps('col-2').onComposerOpenChange(true));
    const before = lastColumnProps('col-2').composerFocusNonce;

    act(() => pressC());

    expect(lastColumnProps('col-2').composerOpen).toBe(true);
    expect(lastColumnProps('col-1').composerOpen).toBe(false);
    expect(lastColumnProps('col-2').composerFocusNonce).toBe(before + 1);
  });

  it('stays quiet for a role that cannot add tasks', () => {
    renderCanvas({ columns: [column('col-1', 1)], canMutateTasks: false });

    act(() => pressC());

    expect(lastColumnProps('col-1').composerOpen).toBe(false);
  });
});
