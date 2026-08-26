import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import messages from '@/messages/en.json';
import { DeleteTaskDialog } from './delete-task-dialog';
import { TaskPanel } from './task-panel';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({
  // `get` is here for the checklist surface: a task the board handed over carries
  // `checklists: null`, so the panel goes and reads the items itself.
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiStatus: () => null,
  resolveApiMessage: () => 'error',
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The properties and discussion panels read comments, activity, members and labels through one
// shared hook the panel owns. None of that fetch is part of this file's contract, so the hook is
// stubbed and both real panels render against it, which is what gives the order assertion below
// something to measure, and the mention picker (a layer of its own inside the panel) a member to
// offer. `vi.hoisted` because the factory runs before this module's own bindings exist.
const taskMeta = vi.hoisted(() => ({
  members: [
    {
      id: 'm1',
      workspaceId: 'w1',
      userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51',
      role: 'MEMBER',
      name: 'Ayşe Yıldız',
      avatarUrl: null,
    },
  ],
  boardLabels: [],
  setBoardLabels: vi.fn(),
  comments: [],
  setComments: vi.fn(),
  hasMoreComments: false,
  loadingMoreComments: false,
  loadMoreComments: vi.fn(),
  activities: [],
  refreshActivities: vi.fn().mockResolvedValue(undefined),
  loadingMeta: false,
  metaFailed: false,
}));
vi.mock('./use-task-metadata', () => ({ useTaskMetadata: () => taskMeta }));

// The attachment surface owns a read of its own (`GET .../attachments`) plus the instance
// config, neither of which is part of this file's contract. The hook is stubbed rather than the
// component, so the real section still renders and the order assertion below has something to
// measure.
vi.mock('./use-task-attachments', () => ({
  useTaskAttachments: () => ({
    attachments: [],
    storageEnabled: true,
    loading: false,
    loadFailed: false,
    pending: false,
    upload: vi.fn(),
    addLink: vi.fn(),
    remove: vi.fn(),
  }),
}));

const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

const task: TaskDto = {
  id: TASK_ID,
  boardId: 'b1',
  columnId: 'c1',
  title: 'Fix the login bug',
  description: null,
  priority: Priority.MEDIUM,
  position: 1000,
  dueDate: null,
  estimatedMinutes: null,
  createdById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  assignees: [],
  labels: [],
  checklistSummary: { total: 0, done: 0 },
  checklists: null,
  attachmentCount: 0,
};

/**
 * Mirrors the shape the panel actually lives in: the board's `<main>` landmark, the task card
 * that links to it, the panel rendered next to them only while the route selects a task, and
 * the delete confirmation the board owns (`board-dialogs.tsx`) but the panel opens.
 */
function Board({
  open,
  card = true,
  selected = task,
  loading = false,
  loadError = null,
  onRetryLoad,
}: {
  open: boolean;
  card?: boolean;
  /** `null` while the board is still fetching the task the URL points at. */
  selected?: TaskDto | null;
  loading?: boolean;
  loadError?: string | null;
  onRetryLoad?: () => void;
}): React.ReactElement {
  const [deleting, setDeleting] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <main>
        {card ? (
          <a href={`/board/b1/task/${TASK_ID}`} data-testid="card">
            Open task
          </a>
        ) : null}
        <button type="button" data-testid="board-menu">
          Board menu
        </button>
        {open ? (
          <TaskPanel
            workspaceId="w1"
            boardId="b1"
            task={selected}
            canMutate
            canManageLabels
            loading={loading}
            loadError={loadError}
            onRetryLoad={onRetryLoad}
            onUpdated={vi.fn()}
            onRequestDelete={() => setDeleting(true)}
          />
        ) : null}
        <DeleteTaskDialog
          open={deleting}
          onOpenChange={setDeleting}
          workspaceId="w1"
          task={selected}
          onDeleted={() => setDeleting(false)}
        />
      </main>
    </NextIntlClientProvider>
  );
}

const heading = (): HTMLElement => screen.getByRole('heading', { name: task.title });
const card = (): HTMLElement => screen.getByTestId('card');
const landmark = (): HTMLElement => screen.getByRole('main');

beforeAll(() => {
  // jsdom ships no layout and therefore no `scrollIntoView`, which the mention picker calls
  // every time the highlighted option moves.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe('TaskPanel focus', () => {
  it('moves focus to the panel heading when it opens', () => {
    const { rerender } = render(<Board open={false} />);
    card().focus();

    rerender(<Board open />);

    expect(document.activeElement).toBe(heading());
  });

  it('returns focus to the card that opened it when the panel closes', () => {
    const { rerender } = render(<Board open={false} />);
    const opener = card();
    opener.focus();
    rerender(<Board open />);
    expect(document.activeElement).toBe(heading());

    rerender(<Board open={false} />);

    expect(document.activeElement).toBe(opener);
  });

  it('falls back to the board landmark when the card that opened it is gone', () => {
    const { rerender } = render(<Board open={false} />);
    card().focus();
    rerender(<Board open />);

    // The task was deleted, filtered out, or moved by another client while the panel was up.
    rerender(<Board open card={false} />);
    rerender(<Board open={false} card={false} />);

    expect(document.activeElement).toBe(landmark());
    expect(document.body.contains(document.activeElement)).toBe(true);
  });

  it('leaves the landmark out of the tab order once focus moves on', () => {
    const { rerender } = render(<Board open={false} />);
    card().focus();
    rerender(<Board open />);
    rerender(<Board open={false} card={false} />);
    expect(landmark().getAttribute('tabindex')).toBe('-1');

    screen.getByTestId('board-menu').focus();

    expect(landmark().hasAttribute('tabindex')).toBe(false);
  });

  it('leaves focus where the user moved it outside the panel', () => {
    const { rerender } = render(<Board open={false} />);
    card().focus();
    rerender(<Board open />);
    const elsewhere = screen.getByTestId('board-menu');
    elsewhere.focus();

    rerender(<Board open={false} />);

    expect(document.activeElement).toBe(elsewhere);
  });

  it('keeps the card as the opener when the task finishes loading into the panel', () => {
    const { rerender } = render(<Board open={false} />);
    const opener = card();
    opener.focus();

    // The board opens the panel before the task arrives, then fills it in. The second pass
    // must not adopt the panel's own heading as the thing that opened it.
    rerender(<Board open selected={null} />);
    rerender(<Board open />);
    expect(document.activeElement).toBe(heading());

    rerender(<Board open={false} />);

    expect(document.activeElement).toBe(opener);
  });

  it('falls back to the landmark when the panel was opened straight from a deep link', () => {
    // No card was involved and nothing was focused, so `<body>` is the only candidate — and
    // that is the lost-focus state, not somewhere to send the user back to.
    const { rerender } = render(<Board open />);
    expect(document.activeElement).toBe(heading());

    rerender(<Board open={false} />);

    expect(document.activeElement).toBe(landmark());
  });
});

/**
 * "Not loaded yet", "not there" and "could not be read" are three different answers, and the
 * panel used to give the middle one to all three: `loadError || !task` put a cold deep link —
 * where the board has not fetched the row yet — straight onto "This task no longer exists".
 */
describe('TaskPanel load states', () => {
  const panel = (): HTMLElement => screen.getByRole('complementary');

  it('waits instead of declaring the task gone while it is still loading', () => {
    render(<Board open card={false} selected={null} loading />);

    expect(screen.queryByText(messages.app.board.task.missing)).toBeNull();
    expect(panel().getAttribute('aria-busy')).toBe('true');
  });

  it('says the task is gone once the load settled without it', () => {
    render(<Board open card={false} selected={null} />);

    expect(screen.getByText(messages.app.board.task.missing)).toBeDefined();
    expect(panel().hasAttribute('aria-busy')).toBe(false);
    // Nothing to retry: the server answered, and the answer was that it is not there.
    expect(screen.queryByRole('button', { name: messages.app.errors.retry })).toBeNull();
  });

  it('separates a failed load from a task that is gone, and offers a retry', () => {
    const onRetryLoad = vi.fn();
    render(
      <Board
        open
        card={false}
        selected={null}
        loadError="This task couldn't load."
        onRetryLoad={onRetryLoad}
      />,
    );

    expect(screen.getByText("This task couldn't load.")).toBeDefined();
    expect(screen.queryByText(messages.app.board.task.missing)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: messages.app.errors.retry }));

    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it('keeps a way back to the board out of every failed state', () => {
    const { rerender } = render(<Board open card={false} selected={null} />);
    expect(screen.getByRole('button', { name: messages.app.board.task.backToBoard })).toBeDefined();

    rerender(<Board open card={false} selected={null} loadError="This task couldn't load." />);

    expect(screen.getByRole('button', { name: messages.app.board.task.backToBoard })).toBeDefined();
  });
});

describe('TaskPanel close', () => {
  it('closes without letting the router reset focus to the board segment', () => {
    render(<Board open />);

    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.close }));

    // `scroll: false` is what stops Next from focusing the new segment on top of the
    // restoration above — see the comment on `close`.
    expect(push).toHaveBeenCalledWith('/board/b1', { scroll: false });
  });
});

/**
 * The panel is a hand-rolled layer: it listens for `Escape` on `window`, which is the last stop
 * of every keystroke in the document, including the ones a layer above it has already dealt
 * with. One press must dismiss exactly one layer.
 */
describe('TaskPanel Escape', () => {
  const deleteTrigger = (): HTMLElement =>
    screen.getByRole('button', { name: messages.app.board.task.deleteAction });
  const composer = (): HTMLTextAreaElement =>
    screen.getByLabelText(messages.app.board.task.addComment) as HTMLTextAreaElement;

  /** Dispatched where the user's keystroke lands, so every listener between it and `window` runs. */
  function pressEscape(): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  }

  /**
   * Typed rather than pasted. React synthesises `onSelect` from the keys around a change, so a
   * change with no keystroke behind it leaves the caret unrecorded and makes the next keydown
   * look like a caret move, which reopens the picker that the same Escape just closed.
   */
  function type(textarea: HTMLTextAreaElement, value: string): void {
    fireEvent.change(textarea, { target: { value, selectionStart: value.length } });
    fireEvent.keyUp(textarea, { key: value.slice(-1) });
  }

  it('closes the panel and hands focus back', () => {
    const { rerender } = render(<Board open={false} />);
    const opener = card();
    opener.focus();
    rerender(<Board open />);

    pressEscape();

    expect(push).toHaveBeenCalledWith('/board/b1', { scroll: false });
    // The router is mocked, so the navigation that `push` stands for is played out by hand.
    rerender(<Board open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it('gives the delete confirmation the first Escape and the panel the second', async () => {
    render(<Board open />);
    const trigger = deleteTrigger();
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeDefined();

    pressEscape();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    // Radix hands the trigger its focus back on a task of its own, not in the keystroke.
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    pressEscape();

    expect(push).toHaveBeenCalledWith('/board/b1', { scroll: false });
  });

  it('dismisses the mention picker without taking the panel with it', () => {
    render(<Board open />);
    const textarea = composer();
    textarea.focus();
    type(textarea, 'ping @Ay');
    expect(screen.getByRole('listbox')).toBeDefined();

    pressEscape();

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * Below `md` the panel is a fullscreen sheet and keeps `Tab` inside itself by hand. A dialog
 * opened from within it is a layer above, with a focus scope of its own: two traps pulling in
 * opposite directions is a keyboard trap (WCAG 2.1.2), so the panel's stands down while a layer
 * is open. jsdom applies no media query on its own, so the breakpoint is stubbed.
 */
describe('TaskPanel mobile Tab trap', () => {
  function matchMobile(): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      media: query,
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  afterEach(() => {
    // Back to jsdom's own state, which is no `matchMedia` at all: the hook reads that as
    // "no breakpoint information" and leaves the trap off, which is what every other test in
    // this file runs against.
    Reflect.deleteProperty(window, 'matchMedia');
  });

  const panel = (): HTMLElement => screen.getByRole('complementary');

  it('lets Tab move on inside a dialog opened from the panel', () => {
    matchMobile();
    render(<Board open />);
    // Held onto before the dialog opens: Radix marks everything outside it `aria-hidden`, so
    // the panel has no accessible role left to query by while the layer above it is up.
    const sheet = panel();
    const trigger = screen.getByRole('button', { name: messages.app.board.task.deleteAction });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const insideDialog = within(dialog).getAllByRole('button')[0]!;
    insideDialog.focus();

    const notPrevented = fireEvent.keyDown(insideDialog, { key: 'Tab' });

    expect(notPrevented).toBe(true);
    expect(sheet.contains(document.activeElement)).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('still pulls Tab back into the panel while it is the topmost layer', () => {
    matchMobile();
    render(<Board open />);
    const outside = screen.getByTestId('board-menu');
    outside.focus();

    const notPrevented = fireEvent.keyDown(outside, { key: 'Tab' });

    expect(notPrevented).toBe(false);
    expect(panel().contains(document.activeElement)).toBe(true);
  });
});

describe('TaskPanel checklists', () => {
  it('reads the items the board row did not carry', async () => {
    // The board's list query answers with the summary only (ADR 0023 K3), so `checklists` is
    // `null` on the row the panel is handed — "not loaded", never "none". A panel that took
    // that at face value would tell the reader a task with three checklists has none.
    vi.mocked(api.get).mockResolvedValue({
      ...task,
      checklistSummary: { total: 2, done: 1 },
      checklists: [
        {
          id: 'cl1',
          title: 'Preparation',
          position: 1000,
          items: [
            { id: 'i1', content: 'Design', isDone: true, position: 1000 },
            { id: 'i2', content: 'API', isDone: false, position: 2000 },
          ],
        },
      ],
    } satisfies TaskDto);

    render(<Board open />);

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`/workspaces/w1/tasks/${TASK_ID}`, expect.anything()),
    );
  });

  it('offers the checklist surface inside the panel rather than behind another click', () => {
    render(<Board open selected={{ ...task, checklists: [] }} />);

    expect(
      screen.getByRole('region', { name: messages.app.board.task.checklist.sectionLabel }),
    ).toBeDefined();
    expect(screen.getByLabelText(messages.app.board.task.checklist.newChecklist)).toBeDefined();
  });
});

describe('TaskPanel attachments', () => {
  it('offers the attachment surface inside the panel rather than behind another click', () => {
    render(<Board open />);

    expect(
      screen.getByRole('region', { name: messages.app.board.task.attachments.sectionLabel }),
    ).toBeDefined();
  });
});

/**
 * The panel reads in the order the card does: what the task *is* first, then what is in it, then
 * what people said about it. That order is why the properties and the discussion are two
 * components rather than one - the single section they used to be could not be moved above the
 * checklists without taking the comment thread with it.
 */
describe('TaskPanel section order', () => {
  const region = (name: string): HTMLElement => screen.getByRole('region', { name });

  it('runs fields, properties, checklists, attachments, discussion', () => {
    render(<Board open selected={{ ...task, checklists: [] }} />);

    const sections = [
      screen.getByLabelText(messages.app.board.task.title),
      region(messages.app.board.task.propertiesTitle),
      region(messages.app.board.task.checklist.sectionLabel),
      region(messages.app.board.task.attachments.sectionLabel),
      region(messages.app.board.task.discussionTitle),
    ];

    for (const [index, section] of sections.slice(0, -1).entries()) {
      expect(
        section.compareDocumentPosition(sections[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('keeps the delete footer the last child of the scroll column', () => {
    // The footer is `mt-auto` and only reaches the bottom of the scroll column while it is the
    // last child of it. A section appended after it looks fine in a screenshot of a long task
    // and wrong on every short one, which is why the position is asserted rather than reviewed.
    render(<Board open />);

    const discussion = region(messages.app.board.task.discussionTitle);
    const footer = screen.getByRole('button', {
      name: messages.app.board.task.deleteAction,
    }).parentElement!;

    expect(footer.nextElementSibling).toBeNull();
    expect(footer.parentElement).toBe(discussion.parentElement);
    expect(footer.className).toContain('mt-auto');
  });
});
