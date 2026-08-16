import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const TASK_ID = '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d';

const mocks = vi.hoisted(() => ({
  boardView: vi.fn(),
  loading: false,
}));

vi.mock('@/components/board/board-view', () => ({
  BoardView: (props: { boardId: string; selectedTaskId?: string }): React.ReactElement => {
    // Throwing a promise that never settles is how a component tells React it is still
    // loading — the one way to get the page's own fallback on screen from a test.
    if (mocks.loading) {
      throw new Promise<void>(() => {});
    }
    mocks.boardView(props);
    return <div data-testid="board-view" />;
  },
}));

import BoardTaskPage from './page';

beforeEach(() => {
  mocks.boardView.mockReset();
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
});

describe('BoardTaskPage', () => {
  it('opens the deep-linked task on top of its own board', async () => {
    render(
      await BoardTaskPage({ params: Promise.resolve({ boardId: BOARD_ID, taskId: TASK_ID }) }),
    );

    expect(screen.getByTestId('board-view')).toBeTruthy();
    // A task URL is the board URL plus a selection — not a separate view.
    expect(mocks.boardView).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: BOARD_ID, selectedTaskId: TASK_ID }),
    );
  });

  it('waits behind the same board skeleton as the board route itself', async () => {
    mocks.loading = true;

    const { container } = render(
      await BoardTaskPage({ params: Promise.resolve({ boardId: BOARD_ID, taskId: TASK_ID }) }),
    );

    expect(screen.queryByTestId('board-view')).toBeNull();
    // A deep link into a task still loads the whole board, so the wait has to look like one.
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });
});
