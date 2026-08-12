import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type BoardDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { BoardList } from './board-list';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const workspace = vi.hoisted(() => ({
  value: { activeId: '', activeRole: null as MemberRole | null },
}));

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));

const fetchBoards = vi.mocked(fetchWorkspaceBoards);

function board(id: string): BoardDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: `Board ${id}`,
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as BoardDto;
}

function renderList(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardList />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  fetchBoards.mockReset();
  workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.ADMIN };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BoardList', () => {
  it('lists the boards it loaded', async () => {
    fetchBoards.mockResolvedValue([board('b1')]);
    renderList();

    expect(await screen.findByText('Board b1')).toBeDefined();
  });

  it('shows the empty state when the workspace really has no boards', async () => {
    fetchBoards.mockResolvedValue([]);
    renderList();

    expect(await screen.findByText(messages.app.board.emptyTitle)).toBeDefined();
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });

  it('reports a failed load', async () => {
    fetchBoards.mockRejectedValue(new Error('network'));
    renderList();

    expect(await screen.findByText(messages.app.board.listError)).toBeDefined();
  });

  it('offers a way out of a failed load, not just the news of it', async () => {
    // A load nobody explained is the retryable half of §7: the recovery has to be a control,
    // because there is nothing else on this screen for the user to press.
    fetchBoards.mockRejectedValueOnce(new Error('network'));
    renderList();

    await screen.findByText(messages.app.board.listError);
    fetchBoards.mockResolvedValue([board('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70')]);
    fireEvent.click(screen.getByRole('button', { name: messages.app.errors.retry }));

    expect(await screen.findByText('Board 0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70')).toBeDefined();
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });

  /**
   * No active workspace is a moment, not a failure: the shell resolves the roster and, when
   * it is empty, redirects to `/workspaces/new`. Answering "Your boards couldn't load." blames a
   * request that was never made — and it is the one thing on screen while the redirect runs.
   */
  it('waits rather than blaming a load when there is no active workspace yet', () => {
    workspace.value = { activeId: '', activeRole: null };
    renderList();

    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(fetchBoards).not.toHaveBeenCalled();
  });

  it('keeps the same waiting shape while the boards are actually loading', async () => {
    fetchBoards.mockImplementation(() => new Promise(() => {}));
    renderList();

    await waitFor(() => expect(fetchBoards).toHaveBeenCalled());
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });
});
