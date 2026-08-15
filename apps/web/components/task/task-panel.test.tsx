import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import messages from '@/messages/en.json';
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

// The metadata panel fetches comments, activity, members and labels. None of that is part of
// the panel's focus contract, and all of it would have to be stubbed to render it here.
vi.mock('./task-metadata-panel', () => ({
  TaskMetadataPanel: (): React.ReactElement => <div data-testid="metadata" />,
}));

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
 * that links to it, and the panel rendered next to them only while the route selects a task.
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
            onRequestDelete={vi.fn()}
          />
        ) : null}
      </main>
    </NextIntlClientProvider>
  );
}

const heading = (): HTMLElement => screen.getByRole('heading', { name: task.title });
const card = (): HTMLElement => screen.getByTestId('card');
const landmark = (): HTMLElement => screen.getByRole('main');

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

  it('closes on Escape', () => {
    render(<Board open />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(push).toHaveBeenCalledWith('/board/b1', { scroll: false });
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

  it('keeps the delete footer last, with attachments above the metadata panel', () => {
    // The footer is `mt-auto` and only reaches the bottom of the scroll column while it is the
    // last child of it. A section appended after it looks fine in a screenshot of a long task
    // and wrong on every short one, which is why the position is asserted rather than reviewed.
    render(<Board open />);

    const attachments = screen.getByRole('region', {
      name: messages.app.board.task.attachments.sectionLabel,
    });
    const metadata = screen.getByTestId('metadata');
    const footer = screen.getByRole('button', {
      name: messages.app.board.task.deleteAction,
    }).parentElement!;

    expect(attachments.compareDocumentPosition(metadata)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(footer.nextElementSibling).toBeNull();
    expect(footer.parentElement).toBe(metadata.parentElement);
  });
});
