import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

/** The props `DndContext` was handed, so the `onDragOver` the insertion rail rides on is visible. */
const context = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    // The context and the columns are stubbed out because a drag is not what is under test:
    // what is, is the single prop below.
    DndContext: (props: { children?: React.ReactNode }) => {
      context.props(props);
      return <>{props.children}</>;
    },
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
    // The stub keeps the one piece of the real column the canvas navigates by: the heading, its
    // `data-slot` and its tab stop. That the real column renders exactly this is asserted in
    // board-column.test.tsx.
    return (
      <section data-testid="board-column">
        {/* Mirrors the real column's heading, which carries the same suppression. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <h2 data-slot="column-heading" tabIndex={(props as ColumnProps).headingTabbable ? 0 : -1}>
          {(props as ColumnProps).column.name}
        </h2>
      </section>
    );
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

const baseDnd: BoardTaskDndController = {
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

let dnd: BoardTaskDndController = baseDnd;

function renderCanvas(
  options: {
    columns?: ColumnDto[];
    canMutateTasks?: boolean;
    workspaceId?: string | null;
    dropIndicator?: BoardTaskDndController['dropIndicator'];
    isDragging?: boolean;
  } = {},
): void {
  dnd = {
    ...baseDnd,
    dropIndicator: options.dropIndicator ?? null,
    isDragging: options.isDragging ?? false,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardCanvas
        boardId={BOARD_ID}
        workspaceId={options.workspaceId === undefined ? WORKSPACE_ID : options.workspaceId}
        columns={options.columns ?? ([] as ColumnDto[])}
        tasksByColumn={new Map<string, TaskDto[]>()}
        selectedTaskId={null}
        taskSignals={new Map()}
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

/** The element that actually scrolls, which is where the overflow is measured. */
function scroller(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="board-scroller"]');
  if (node === null) throw new Error('the column strip was not rendered');
  return node;
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
  context.props.mockClear();
  dnd = baseDnd;
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

describe('BoardCanvas drop indicator', () => {
  /** The props `DndContext` was last rendered with. */
  function lastContextProps(): Record<string, unknown> {
    const call = context.props.mock.calls.at(-1);
    if (call === undefined) throw new Error('DndContext was not rendered');
    return call[0] as Record<string, unknown>;
  }

  it('hands the drag-over handler to DndContext', () => {
    renderCanvas({ columns: [column('col-1', 1)] });

    expect(lastContextProps().onDragOver).toBe(baseDnd.onDragOver);
  });

  it('gives the slot to the targeted column and nothing to the others', () => {
    renderCanvas({
      columns: [column('col-1', 1), column('col-2', 2)],
      dropIndicator: { columnId: 'col-2', index: 3 },
    });

    expect(lastColumnProps('col-2').dropIndicatorIndex).toBe(3);
    // A primitive rather than the indicator object: a column that is not the target is handed a
    // prop equal in value for the whole drag rather than a fresh object on every change.
    expect(lastColumnProps('col-1').dropIndicatorIndex).toBeNull();
  });

  it('gives every column nothing while no drag is over the board', () => {
    renderCanvas({ columns: [column('col-1', 1)] });

    expect(lastColumnProps('col-1').dropIndicatorIndex).toBeNull();
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
    act(() => lastColumnProps('col-1').onComposerOpenChange('col-1', false));

    expect(lastColumnProps('col-1').composerOpen).toBe(false);
  });

  it('leaves an open composer where it is and bumps its focus nonce instead', () => {
    renderCanvas({ columns: [column('col-1', 1), column('col-2', 2)], canMutateTasks: true });

    act(() => lastColumnProps('col-2').onComposerOpenChange('col-2', true));
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

const COLUMNS = [column('col-1', 1), column('col-2', 2), column('col-3', 3)];

function headings(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="column-heading"]'));
}

describe('BoardCanvas column keyboard navigation', () => {
  beforeEach(() => {
    // jsdom implements no scrolling at all, so the method the canvas calls to bring the newly
    // focused heading into view does not exist on the prototype.
    Element.prototype.scrollIntoView = vi.fn();
  });

  // A plain assignment rather than a spy, because there is no property to spy on; the file's
  // own `vi.restoreAllMocks()` therefore cannot take it back off and a later test would keep
  // reading this one's stub.
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('moves focus to the first heading on Home', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[2]!.focus();

    fireEvent.keyDown(all[2]!, { key: 'Home' });

    expect(document.activeElement).toBe(all[0]);
    expect(all[0]!.closest('section')!.scrollIntoView).toHaveBeenCalled();
  });

  /**
   * The heading sits inside its column's header padding, so scrolling the heading itself would
   * stop 12px short and leave the column's leading edge, and the focus outline around it, under
   * the edge mask. What is brought into view is the column.
   */
  it('brings the whole column into view, not just the heading', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    const headingScroll = vi.fn();
    const columnScroll = vi.fn();
    Object.defineProperty(all[0]!, 'scrollIntoView', {
      configurable: true,
      value: headingScroll,
    });
    Object.defineProperty(all[0]!.closest('section')!, 'scrollIntoView', {
      configurable: true,
      value: columnScroll,
    });
    all[2]!.focus();

    fireEvent.keyDown(all[2]!, { key: 'Home' });

    expect(columnScroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'start' });
    expect(headingScroll).not.toHaveBeenCalled();
  });

  /**
   * `focus()` scrolls the element just inside the scrollport and ignores `scroll-padding`, which
   * would leave the first column at the strip's own padding rather than at 0 and light an edge
   * mask with nothing behind it. `scrollIntoView` is the only scroll this path performs.
   */
  it('scrolls through scrollIntoView alone, never through focus', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    const focus = vi.spyOn(all[0]!, 'focus');
    all[2]!.focus();

    fireEvent.keyDown(all[2]!, { key: 'Home' });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('moves focus to the last heading on End', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'End' });

    expect(document.activeElement).toBe(all[2]);
  });

  it('moves one column at a time with Ctrl plus an arrow', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'ArrowRight', ctrlKey: true });
    expect(document.activeElement).toBe(all[1]);

    fireEvent.keyDown(all[1]!, { key: 'ArrowLeft', ctrlKey: true });
    expect(document.activeElement).toBe(all[0]);
  });

  it('stays where it is at either end of the strip', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'ArrowLeft', ctrlKey: true });

    expect(document.activeElement).toBe(all[0]);
  });

  /**
   * A bare arrow inside a column is @dnd-kit's keyboard drag and the caret in the composer; the
   * canvas only ever answers the modified pair.
   */
  it('leaves a bare arrow alone', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(all[0]);
  });

  it('answers nothing pressed outside a heading', () => {
    renderCanvas({ columns: COLUMNS });
    const strip = scroller();
    const all = headings();
    all[1]!.focus();

    fireEvent.keyDown(strip, { key: 'Home' });

    expect(document.activeElement).toBe(all[1]);
  });
});

/**
 * The 24px edge masks are drawn by CSS from this attribute, so what the canvas owns is the
 * measurement: a mask appears only where there is something to scroll to.
 */
describe('BoardCanvas edge masks', () => {
  function setMetrics(scrollLeft: number, scrollWidth: number, clientWidth: number): void {
    const node = scroller();
    for (const [key, value] of Object.entries({ scrollLeft, scrollWidth, clientWidth })) {
      Object.defineProperty(node, key, { configurable: true, value });
    }
    fireEvent.scroll(node);
  }

  function overflow(): string | null {
    const strip = document.querySelector('[data-slot="board-canvas"]');
    if (strip === null) throw new Error('the canvas was not rendered');
    return strip.getAttribute('data-overflow');
  }

  it('marks nothing while the columns fit', () => {
    renderCanvas({ columns: COLUMNS });
    setMetrics(0, 900, 900);

    expect(overflow()).toBeNull();
  });

  it('marks the right edge at the start of a strip that overflows', () => {
    renderCanvas({ columns: COLUMNS });
    setMetrics(0, 1800, 900);

    expect(overflow()).toBe('right');
  });

  it('marks the left edge at the end of it', () => {
    renderCanvas({ columns: COLUMNS });
    setMetrics(900, 1800, 900);

    expect(overflow()).toBe('left');
  });

  it('marks both edges in the middle', () => {
    renderCanvas({ columns: COLUMNS });
    setMetrics(400, 1800, 900);

    expect(overflow()).toBe('both');
  });

  it('re-measures when the window changes size', () => {
    renderCanvas({ columns: COLUMNS });
    setMetrics(0, 1800, 900);
    expect(overflow()).toBe('right');

    const node = scroller();
    Object.defineProperty(node, 'clientWidth', { configurable: true, value: 1800 });
    fireEvent(window, new Event('resize'));

    expect(overflow()).toBeNull();
  });
});

/**
 * Snap and drag both want the strip's scroll position. A mandatory snap would pull @dnd-kit's
 * autoscroll back to the column it started from, which is how a card gets stuck one column away
 * from where it is being carried.
 */
describe('BoardCanvas snap during a drag', () => {
  it('snaps to columns while nothing is being dragged', () => {
    renderCanvas({ columns: COLUMNS });

    expect(scroller().className.split(/\s+/)).toContain('max-md:snap-mandatory');
    expect(scroller().hasAttribute('data-dragging')).toBe(false);
  });

  it('lets go of the snap while a card is in the air', () => {
    renderCanvas({ columns: COLUMNS, isDragging: true });

    expect(scroller().getAttribute('data-dragging')).toBe('true');
  });
});

/**
 * The board is a composite widget (docs/design.md §5): `Tab` reaches one column, and the keys
 * above move between them. Eight columns must therefore cost one tab stop, not eight.
 */
describe('BoardCanvas roving tab stop', () => {
  const tabIndexes = (): (string | null)[] =>
    headings().map((heading) => heading.getAttribute('tabindex'));

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('puts exactly one heading in the tab order, the first by default', () => {
    renderCanvas({ columns: COLUMNS });

    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
  });

  it('moves the tab stop with Ctrl plus an arrow', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'ArrowRight', ctrlKey: true });

    expect(tabIndexes()).toEqual(['-1', '0', '-1']);
  });

  it('moves it to either end with Home and End', () => {
    renderCanvas({ columns: COLUMNS });
    const all = headings();
    all[0]!.focus();

    fireEvent.keyDown(all[0]!, { key: 'End' });
    expect(tabIndexes()).toEqual(['-1', '-1', '0']);

    fireEvent.keyDown(headings()[2]!, { key: 'Home' });
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
  });

  it('follows focus arriving on a heading any other way', () => {
    renderCanvas({ columns: COLUMNS });

    act(() => headings()[2]!.focus());

    expect(tabIndexes()).toEqual(['-1', '-1', '0']);
  });
});
