import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

const mocks = vi.hoisted(() => ({
  boardView: vi.fn(),
}));

vi.mock('@/components/board/board-view', () => ({
  BoardView: (props: { boardId: string; selectedTaskId?: string }): React.ReactElement => {
    mocks.boardView(props);
    return <div data-testid="board-view" />;
  },
}));

import BoardPage from './page';

beforeEach(() => {
  mocks.boardView.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('BoardPage', () => {
  it('awaits the route params and hands the board id to the board view', async () => {
    render(await BoardPage({ params: Promise.resolve({ boardId: BOARD_ID }) }));

    expect(screen.getByTestId('board-view')).toBeTruthy();
    expect(mocks.boardView).toHaveBeenCalledWith(expect.objectContaining({ boardId: BOARD_ID }));
  });

  it('selects no task on the plain board route', async () => {
    render(await BoardPage({ params: Promise.resolve({ boardId: BOARD_ID }) }));

    expect(mocks.boardView.mock.calls[0]?.[0].selectedTaskId).toBeUndefined();
  });
});
