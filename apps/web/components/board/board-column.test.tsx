import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { NextIntlClientProvider } from 'next-intl';
import { ColumnCategory, Priority, type ColumnDto, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import type { TaskCardSignal } from '@/components/task/task-card';
import { ApiError, api } from '@/lib/api';
import {
  BoardColumn,
  COLUMN_INITIAL_RENDER_BUDGET,
  COLUMN_RENDER_BUDGET_STEP,
} from './board-column';

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

const apiPost = vi.mocked(api.post);

/**
 * `isOver` is dnd-kit's, and reaching it for real would mean driving a pointer drag across two
 * measured rects in a DOM that measures everything as zero. `vi.mock('@dnd-kit/core')` replaces
 * the module for the whole import graph, not just the one call site: sortable's own internal
 * `useDroppable` sees the flag too, since it imports the same module this file mocks. The flag is
 * `false` for every other test in this file, which is what the real hook returns there anyway.
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
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d13';

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

/**
 * `BoardCanvas` owns which column has its composer open, so the column is a controlled
 * component and a test needs the other half of that pair to click anything.
 */
function ColumnHarness({
  tasks,
  selectedTaskId,
  onTaskCreated,
  dropIndicatorIndex,
  taskSignals,
  headingTabbable = true,
}: {
  tasks: TaskDto[];
  selectedTaskId: string | null;
  onTaskCreated: (task: TaskDto) => void;
  dropIndicatorIndex: number | null;
  taskSignals?: ReadonlyMap<string, TaskCardSignal>;
  headingTabbable?: boolean;
}): React.ReactElement {
  const [composerOpen, setComposerOpen] = useState(false);
  return (
    <BoardColumn
      column={column}
      tasks={tasks}
      boardId={BOARD_ID}
      workspaceId={WORKSPACE_ID}
      selectedTaskId={selectedTaskId}
      headingTabbable={headingTabbable}
      canMutateColumns
      canMutateTasks
      canMoveLeft={false}
      canMoveRight={false}
      onOpenSettings={vi.fn()}
      onDelete={vi.fn()}
      onMoveColumn={vi.fn()}
      composerOpen={composerOpen}
      composerFocusNonce={0}
      onComposerOpenChange={(_columnId, open) => setComposerOpen(open)}
      staggerIndex={null}
      onTaskCreated={onTaskCreated}
      dropIndicatorIndex={dropIndicatorIndex}
      taskSignals={taskSignals}
    />
  );
}

function renderColumn(
  tasks: TaskDto[],
  selectedTaskId: string | null = null,
  onTaskCreated: (task: TaskDto) => void = vi.fn(),
  dropIndicatorIndex: number | null = null,
  taskSignals?: ReadonlyMap<string, TaskCardSignal>,
  headingTabbable = true,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DndContext>
        <ColumnHarness
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onTaskCreated={onTaskCreated}
          dropIndicatorIndex={dropIndicatorIndex}
          taskSignals={taskSignals}
          headingTabbable={headingTabbable}
        />
      </DndContext>
    </NextIntlClientProvider>,
  );
}

const rail = (): HTMLElement | null => document.querySelector('[data-slot="drop-indicator"]');

/** How many cards the rail is drawn after, which is the slot the drop lands in. */
function railSlot(): number {
  const element = rail();
  if (element === null) throw new Error('no drop indicator is rendered');
  const siblings = Array.from(element.parentElement?.children ?? []);
  return siblings
    .slice(0, siblings.indexOf(element))
    .filter((sibling) => sibling.querySelector('a') !== null).length;
}

const composerCopy = messages.app.board.column;

const addTaskButton = (): HTMLElement =>
  screen.getByRole('button', { name: messages.app.board.task.createAction });

const field = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: composerCopy.composerPlaceholder }) as HTMLInputElement;

const composerForm = (): HTMLFormElement => {
  const form = document.querySelector('[data-slot="task-composer"]');
  if (!(form instanceof HTMLFormElement)) throw new Error('the composer is not open');
  return form;
};

const openDetailButton = (): HTMLElement =>
  screen.getByRole('button', { name: composerCopy.composerOpenDetail });

// One link per mounted card — the column renders no other links.
const cardCount = (): number => screen.queryAllByRole('link').length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  droppableIsOver = false;
});

describe('BoardColumn empty drop zone', () => {
  /**
   * The one resting border in the tree that changed colour when the `*` rule moved into
   * `@layer base`: it had been drawing the hairline grey rather than `--border-strong`. It is
   * solid because docs/design.md §5 allows the board no dashed outline, and §7's own "56px
   * dashed drop zone" was the document contradicting itself rather than a second rule.
   */
  it('draws the empty column a solid border-strong box', () => {
    renderColumn([]);
    const zone = screen.getByText(messages.app.board.column.emptyDrop);
    const classes = new Set(zone.className.split(/\s+/).filter(Boolean));

    expect(classes.has('border-dashed')).toBe(false);
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

  /**
   * A keyboard drag never sets `isOver`: the lifted card becomes a sortable item of the column
   * it is moving into, so @dnd-kit reports a card as the target and the column's own droppable
   * stays cold. The indicator is what the wash and the forced-colours attribute hang on so the
   * two pointer devices show the same thing.
   */
  it('marks the column from the indicator alone, with no droppable ever over it', () => {
    renderColumn(makeTasks(2), null, vi.fn(), 1);

    const section = screen.getByRole('region', { name: column.name });
    expect(section.getAttribute('data-drop-target')).toBe('true');
    expect(section.className.split(/\s+/)).toContain('bg-signature-subtle');
  });
});

describe('BoardColumn insertion rail', () => {
  it('draws nothing while no card is heading for the column', () => {
    renderColumn(makeTasks(3));

    expect(rail()).toBeNull();
  });

  it('draws the rail at the indicated slot', () => {
    renderColumn(makeTasks(3), null, vi.fn(), 2);

    expect(railSlot()).toBe(2);
  });

  it('draws the rail above the first card', () => {
    renderColumn(makeTasks(3), null, vi.fn(), 0);

    expect(railSlot()).toBe(0);
  });

  it('draws the rail after the last card when the drop appends', () => {
    renderColumn(makeTasks(3), null, vi.fn(), 3);

    expect(railSlot()).toBe(3);
  });

  /**
   * The column mounts a budget of cards, not all of them, so an index past the mounted set has
   * no slot to sit in. The end of what is mounted is the closest true statement about where the
   * card lands, and it is also the only part of the column the reader can see.
   */
  it('clamps an index past the mounted cards to the end of them', () => {
    renderColumn(makeTasks(3), null, vi.fn(), 400);

    expect(railSlot()).toBe(3);
  });

  it('draws a copper rule that carries no text and no accessible name', () => {
    renderColumn(makeTasks(2), null, vi.fn(), 1);

    const element = rail()!;
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.textContent).toBe('');
    expect(element.className.split(/\s+/)).toContain('bg-signature');
  });
});

describe('BoardColumn task composer', () => {
  function createdTask(): TaskDto {
    return makeTasks(1)[0]!;
  }

  it('turns the Add task button into a focused field', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());

    expect(field()).toBe(document.activeElement);
    expect(screen.queryByRole('button', { name: messages.app.board.task.createAction })).toBeNull();
  });

  it('creates on Enter and leaves the caret in an emptied field', async () => {
    const task = createdTask();
    apiPost.mockResolvedValue(task);
    const onTaskCreated = vi.fn();
    renderColumn([], null, onTaskCreated);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: '  Ship the composer  ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    await waitFor(() => expect(onTaskCreated).toHaveBeenCalledWith(task));
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards/${BOARD_ID}/tasks`, {
      title: 'Ship the composer',
      columnId: COLUMN_ID,
    });
    await waitFor(() => expect(field().value).toBe(''));
    expect(field()).toBe(document.activeElement);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends nothing for a title that is only whitespace', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('returns to the Add task button on Escape', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(addTaskButton()).toBe(document.activeElement);
  });

  it('returns to the Add task button when an empty field loses focus', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.blur(field());

    expect(addTaskButton()).toBe(document.activeElement);
  });

  it('keeps a typed title when the field loses focus', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Half a thought' } });
    fireEvent.blur(field());

    expect(field().value).toBe('Half a thought');
  });

  it('marks the form busy and holds the field read-only while the create is in flight', async () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Slow one' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    await waitFor(() => expect(composerForm().getAttribute('aria-busy')).toBe('true'));
    // Read-only rather than disabled, which is what keeps the caret in the field.
    expect(field().readOnly).toBe(true);
    expect(field().disabled).toBe(false);
    expect(field()).toBe(document.activeElement);
    // The label is never swapped for a waiting string.
    expect(openDetailButton().textContent).toBe(composerCopy.composerOpenDetail);
  });

  it('ignores a second Enter while the first create is still in flight', async () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Twice' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(composerForm().getAttribute('aria-busy')).toBe('true'));
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('shows the forbidden line when the create is refused', async () => {
    apiPost.mockRejectedValue(
      new ApiError({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' }),
    );
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Not allowed' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      messages.app.board.task.forbidden,
    );
    expect(field().value).toBe('Not allowed');
  });

  it('shows the generic failure line for anything else', async () => {
    apiPost.mockRejectedValue(new Error('offline'));
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Nowhere to go' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      messages.app.board.task.createError,
    );
  });

  /**
   * The failure line takes focus when a create is refused, so it is where the reader is standing
   * when they give up on the composer. Escape is handled on the form rather than on the field
   * for exactly this: the way out has to work from wherever the composer put them.
   */
  it('returns to the Add task button on Escape from the failure line', async () => {
    apiPost.mockRejectedValue(new Error('offline'));
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Nowhere to go' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert).toBe(document.activeElement);

    fireEvent.keyDown(alert, { key: 'Escape' });

    expect(addTaskButton()).toBe(document.activeElement);
  });

  it('creates the task and opens its panel from Open details', async () => {
    const task = createdTask();
    apiPost.mockResolvedValue(task);
    const onTaskCreated = vi.fn();
    renderColumn([], null, onTaskCreated);

    fireEvent.click(addTaskButton());
    fireEvent.change(field(), { target: { value: 'Needs a due date' } });
    fireEvent.click(openDetailButton());

    await waitFor(() => expect(onTaskCreated).toHaveBeenCalledWith(task));
    expect(router.push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${task.id}`);
  });

  it('offers Open details only once something is typed', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    expect(openDetailButton().hasAttribute('disabled')).toBe(true);

    fireEvent.change(field(), { target: { value: 'A title' } });
    expect(openDetailButton().hasAttribute('disabled')).toBe(false);
  });

  it('keeps the composer open while focus moves to Open details', () => {
    renderColumn([]);

    fireEvent.click(addTaskButton());
    fireEvent.blur(field(), { relatedTarget: openDetailButton() });

    expect(composerForm()).toBeDefined();
  });

  it('offers no composer at all without an active workspace', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DndContext>
          <BoardColumn
            column={column}
            tasks={[]}
            boardId={BOARD_ID}
            workspaceId={null}
            selectedTaskId={null}
            dropIndicatorIndex={null}
            headingTabbable
            canMutateColumns
            canMutateTasks
            canMoveLeft={false}
            canMoveRight={false}
            onOpenSettings={vi.fn()}
            onDelete={vi.fn()}
            onMoveColumn={vi.fn()}
            composerOpen={false}
            composerFocusNonce={0}
            onComposerOpenChange={vi.fn()}
            onTaskCreated={vi.fn()}
            staggerIndex={null}
          />
        </DndContext>
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole('button', { name: messages.app.board.task.createAction })).toBeNull();
  });
});

describe('BoardColumn feedback marks', () => {
  it('hands each card only the mark the board reports for it', () => {
    renderColumn(
      makeTasks(2),
      null,
      vi.fn(),
      null,
      new Map<string, TaskCardSignal>([['task-0001', 'returning']]),
    );

    const cards = screen.getAllByRole('link');
    expect(cards[0]?.getAttribute('data-state')).toBeNull();
    expect(cards[1]?.getAttribute('data-state')).toBe('returning');
  });
});

/**
 * The board is a composite widget (docs/design.md §5): `Tab` reaches one column and keys move
 * between them from there, so the heading is a roving tab stop rather than a permanent one.
 * `board-canvas.tsx` owns which column holds it; the `data-slot` is how it finds the set.
 */
describe('BoardColumn heading', () => {
  it('is the tab stop while it is the current column', () => {
    renderColumn(makeTasks(1));

    const heading = screen.getByRole('heading', { name: column.name });
    expect(heading.getAttribute('tabindex')).toBe('0');
    expect(heading.getAttribute('data-slot')).toBe('column-heading');
  });

  it('stays focusable but out of the tab order everywhere else', () => {
    renderColumn(makeTasks(1), null, vi.fn(), null, undefined, false);

    expect(screen.getByRole('heading', { name: column.name }).getAttribute('tabindex')).toBe('-1');
  });
});
