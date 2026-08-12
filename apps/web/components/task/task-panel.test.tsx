import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskPanel } from './task-panel';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({
  api: { patch: vi.fn() },
  apiStatus: () => null,
  resolveApiMessage: () => 'error',
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The metadata panel fetches comments, activity, members and labels. None of that is part of
// the panel's focus contract, and all of it would have to be stubbed to render it here.
vi.mock('./task-metadata-panel', () => ({
  TaskMetadataPanel: (): React.ReactElement => <div data-testid="metadata" />,
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
};

/**
 * Mirrors the shape the panel actually lives in: the board's `<main>` landmark, the task card
 * that links to it, and the panel rendered next to them only while the route selects a task.
 */
function Board({
  open,
  card = true,
  selected = task,
}: {
  open: boolean;
  card?: boolean;
  /** `null` while the board is still fetching the task the URL points at. */
  selected?: TaskDto | null;
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
