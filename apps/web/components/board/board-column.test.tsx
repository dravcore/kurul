import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { NextIntlClientProvider } from 'next-intl';
import { ColumnCategory, Priority, type ColumnDto, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import {
  BoardColumn,
  COLUMN_INITIAL_RENDER_BUDGET,
  COLUMN_RENDER_BUDGET_STEP,
} from './board-column';

/**
 * `isOver` is dnd-kit's, and reaching it for real would mean driving a pointer drag across two
 * measured rects in a DOM that measures everything as zero. The flag below replaces that one
 * value and leaves the rest of dnd-kit alone; it is `false` for every other test in this file,
 * which is what the real hook returns there anyway.
 */
let droppableIsOver = false;

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => ({
      ...actual.useDroppable(args),
      isOver: droppableIsOver,
    }),
  };
});

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d11';

const column: ColumnDto = {
  id: COLUMN_ID,
  boardId: BOARD_ID,
  name: 'Backlog',
  position: 1000,
  color: null,
  category: ColumnCategory.BACKLOG,
  taskCount: 0,
};

function makeTasks(count: number): TaskDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${String(index).padStart(4, '0')}`,
    boardId: BOARD_ID,
    columnId: COLUMN_ID,
    title: `Task ${index}`,
    description: null,
    priority: Priority.MEDIUM,
    position: (index + 1) * 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d12',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  }));
}

/**
 * jsdom has no IntersectionObserver. The stub records every observer the column creates and
 * lets a test fire one, which is the only way to exercise the reveal — the component
 * deliberately does nothing when the constructor is missing.
 */
type StubObserver = { trigger: (isIntersecting: boolean) => void; disconnected: boolean };

function installIntersectionObserver(): StubObserver[] {
  const observers: StubObserver[] = [];
  class Stub {
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(): void {
      const entry = { isIntersecting: true } as IntersectionObserverEntry;
      const record: StubObserver = {
        disconnected: false,
        trigger: (isIntersecting: boolean) => {
          this.callback(
            [{ ...entry, isIntersecting }] as IntersectionObserverEntry[],
            this as unknown as IntersectionObserver,
          );
        },
      };
      observers.push(record);
    }
    disconnect(): void {
      const last = observers.at(-1);
      if (last) last.disconnected = true;
    }
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Stub);
  return observers;
}

function renderColumn(tasks: TaskDto[], selectedTaskId: string | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DndContext>
        <BoardColumn
          column={column}
          tasks={tasks}
          boardId={BOARD_ID}
          selectedTaskId={selectedTaskId}
          canMutateColumns
          canMutateTasks
          canMoveLeft={false}
          canMoveRight={false}
          onOpenSettings={vi.fn()}
          onDelete={vi.fn()}
          onMoveLeft={vi.fn()}
          onMoveRight={vi.fn()}
          onAddTask={vi.fn()}
        />
      </DndContext>
    </NextIntlClientProvider>,
  );
}

// One link per mounted card — the column renders no other links.
const cardCount = (): number => screen.queryAllByRole('link').length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  droppableIsOver = false;
});

describe('BoardColumn empty drop zone', () => {
  /**
   * The one resting border in the tree that changed colour when the `*` rule moved into
   * `@layer base`: it had been drawing the hairline grey rather than `--border-strong`. It is
   * the empty-column affordance of docs/design.md §7, not a live drop target, which is why it
   * is allowed the dashed outline §5 forbids while a card is in the air.
   */
  it('draws the empty column its dashed border-strong outline', () => {
    renderColumn([]);
    const zone = screen.getByText(messages.app.board.column.emptyDrop);
    const classes = new Set(zone.className.split(/\s+/).filter(Boolean));

    expect(classes.has('border-dashed')).toBe(true);
    expect(classes.has('border-border-strong')).toBe(true);
    expect(classes.has('border')).toBe(true);
  });

  it('drops the zone as soon as the column holds a task', () => {
    renderColumn(makeTasks(1));

    expect(screen.queryByText(messages.app.board.column.emptyDrop)).toBeNull();
  });
});

describe('BoardColumn render budget', () => {
  it('renders every card when the column is under the budget', () => {
    const observers = installIntersectionObserver();
    renderColumn(makeTasks(5));

    expect(cardCount()).toBe(5);
    // Nothing left to reveal, so no sentinel is rendered and nothing is observed.
    expect(observers).toHaveLength(0);
  });

  it('caps a long column at the initial budget and keeps the header count honest', () => {
    const observers = installIntersectionObserver();
    renderColumn(makeTasks(500));

    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET);
    // The header count is what tells the reader the column continues past what is mounted.
    expect(screen.getByText('500')).not.toBeNull();
    expect(observers).toHaveLength(1);
  });

  it('mounts one more batch each time the sentinel is scrolled into view', () => {
    const observers = installIntersectionObserver();
    renderColumn(makeTasks(500));

    act(() => observers.at(-1)?.trigger(true));
    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET + COLUMN_RENDER_BUDGET_STEP);

    act(() => observers.at(-1)?.trigger(true));
    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET + COLUMN_RENDER_BUDGET_STEP * 2);
  });

  it('ignores a sentinel that leaves the viewport again', () => {
    const observers = installIntersectionObserver();
    renderColumn(makeTasks(500));

    act(() => observers.at(-1)?.trigger(false));

    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET);
  });

  it('stops revealing once the whole column is mounted', () => {
    const observers = installIntersectionObserver();
    renderColumn(makeTasks(COLUMN_INITIAL_RENDER_BUDGET + 3));

    act(() => observers.at(-1)?.trigger(true));

    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET + 3);
    // The sentinel is gone with the last batch, so no further observer is armed.
    expect(observers.at(-1)?.disconnected).toBe(true);
  });

  it('renders a deep-linked task that sits past the budget', () => {
    installIntersectionObserver();
    const tasks = makeTasks(500);
    const deepLinked = tasks[300]!;

    renderColumn(tasks, deepLinked.id);

    // Everything up to and including the selected row, so the card the panel is about is on
    // the board rather than missing from its column.
    expect(cardCount()).toBe(301);
    expect(screen.getByText(deepLinked.title)).not.toBeNull();
  });

  it('renders the initial budget with no IntersectionObserver at all', () => {
    // Server rendering and jsdom both land here; the column must still paint its first batch.
    vi.stubGlobal('IntersectionObserver', undefined);
    renderColumn(makeTasks(500));

    expect(cardCount()).toBe(COLUMN_INITIAL_RENDER_BUDGET);
  });
});

describe('BoardColumn drop target', () => {
  /**
   * The drop tint is a surface change and nothing else, so it is gone under forced colours. The
   * attribute is what `app/globals.css` hangs the Highlight border on there; it exists for no
   * other reason, which is why it is absent rather than `false` while the column is resting.
   */
  it('marks nothing while no card is over the column', () => {
    renderColumn(makeTasks(1));

    const section = screen.getByRole('region', { name: column.name });
    expect(section.hasAttribute('data-drop-target')).toBe(false);
  });

  it('marks the column while a card is over it', () => {
    droppableIsOver = true;
    renderColumn(makeTasks(1));

    const section = screen.getByRole('region', { name: column.name });
    expect(section.getAttribute('data-drop-target')).toBe('true');
    // The tint stays the state's normal-mode mark; the attribute only adds the forced-colours
    // twin of it.
    expect(section.className.split(/\s+/)).toContain('bg-signature-subtle');
  });
});
