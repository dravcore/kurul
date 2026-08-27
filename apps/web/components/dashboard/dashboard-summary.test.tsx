import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { DashboardSummary } from './dashboard-summary';

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID, workspaces: [], refresh: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01',
  workspaceId: WORKSPACE_ID,
  name: 'Product Board',
  description: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};
const EMPTY_SUMMARY = {
  totalTasks: 0,
  openTasks: 0,
  overdueTasks: 0,
  completedThisWeek: 0,
  byPriority: [],
  byColumn: [],
  byAssignee: [],
  completionTrend: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSummary(): void {
  vi.mocked(fetchWorkspaceBoards).mockResolvedValue([BOARD]);
  vi.mocked(api.get).mockResolvedValue(EMPTY_SUMMARY);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DashboardSummary />
    </NextIntlClientProvider>,
  );
}

/**
 * The zero-task state of a workspace that already has boards, which is where this screen shows
 * two actions at once: this section's "Open a board" and the board list's own "Create board"
 * below it. Measured on the running app, both were filled copper, which with the sidebar rail
 * put three full-strength marks on one screen against §2's two.
 *
 * "Create board" is the action this route carries in every state, so it keeps the fill and the
 * shortcut offered here steps down to outline. Nothing else about the empty state changes: it
 * still carries its damga mark, its headline and its one action.
 */
describe('DashboardSummary empty state', () => {
  it('offers the board shortcut without spending the route’s one copper action', async () => {
    renderSummary();

    const action = await waitFor(() =>
      screen.getByRole('link', { name: messages.app.dashboard.openBoard }),
    );

    expect(action.getAttribute('data-variant')).toBe('outline');
  });

  it('still invites the next move with a mark, a headline and one action', async () => {
    renderSummary();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: messages.app.dashboard.emptyTitle }),
      ).toBeDefined();
    });
    expect(screen.getByText(messages.app.dashboard.emptyBody)).toBeDefined();
    expect(screen.getByRole('link', { name: messages.app.dashboard.openBoard })).toBeDefined();
  });
});

/**
 * The other half of the zero-task state: a workspace with no boards at all. `BoardList`,
 * rendered below this section on the real `/dashboard` route, already draws its own damga mark,
 * headline and "Create board" action for exactly this case, so this section renders nothing
 * rather than a second mark stacked on top of it.
 */
describe('DashboardSummary with no boards at all', () => {
  it('renders nothing, leaving the board list as the page’s one empty state', async () => {
    vi.mocked(fetchWorkspaceBoards).mockResolvedValue([]);
    vi.mocked(api.get).mockResolvedValue(EMPTY_SUMMARY);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DashboardSummary />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('heading', { name: messages.app.dashboard.emptyTitle })).toBeNull();
  });
});

/**
 * The dashboard summary and the board roster are two independent requests (`lib/api.ts` and
 * `lib/workspace-boards.ts`), unsynchronized with each other. `useApiResource` starts `boards`
 * at `[]` and, on a failed load, resets it back to `[]` too, the same shape a workspace with
 * genuinely zero boards has. Rendering nothing on that guess, before boards has an answer of
 * its own, would hide this section's empty state for a workspace that does have boards.
 */
describe('DashboardSummary while the boards fetch has not answered yet', () => {
  it('keeps the zero-board empty state visible instead of hiding it on an unresolved boards call', async () => {
    let resolveBoards = (_boards: (typeof BOARD)[]): void => {};
    const boardsPromise = new Promise<(typeof BOARD)[]>((resolve) => {
      resolveBoards = resolve;
    });
    vi.mocked(fetchWorkspaceBoards).mockReturnValue(boardsPromise);
    vi.mocked(api.get).mockResolvedValue(EMPTY_SUMMARY);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DashboardSummary />
      </NextIntlClientProvider>,
    );

    // The summary already answered "zero tasks"; boards has not answered at all yet. The
    // section must still show its own empty state rather than render nothing on the guess
    // that an unresolved `[]` means "confirmed no boards".
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: messages.app.dashboard.emptyTitle }),
      ).toBeDefined();
    });
    expect(screen.queryByRole('link', { name: messages.app.dashboard.openBoard })).toBeNull();

    resolveBoards([BOARD]);

    expect(
      await screen.findByRole('link', { name: messages.app.dashboard.openBoard }),
    ).toBeDefined();
  });

  it('keeps the zero-board empty state visible when the boards fetch fails independently', async () => {
    vi.mocked(fetchWorkspaceBoards).mockRejectedValue(new Error('network error'));
    vi.mocked(api.get).mockResolvedValue(EMPTY_SUMMARY);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DashboardSummary />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: messages.app.dashboard.emptyTitle }),
      ).toBeDefined();
    });
  });
});
