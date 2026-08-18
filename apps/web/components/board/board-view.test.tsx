import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { BoardView } from './board-view';
import { useBoardData, type UseBoardDataResult } from './use-board-data';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/board/${BOARD_ID}`,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { useSession: () => ({ data: null }) },
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID, activeRole: MemberRole.MEMBER }),
}));

// This file's contract is the loading/error screen, which renders before the realtime socket
// or any mutation ever fires — both are stubbed so the test does not have to stand up a fake
// socket or an `api` double to reach it.
vi.mock('./use-board-realtime', () => ({
  useBoardRealtime: () => ({ connected: true }),
}));

vi.mock('./use-board-mutations', () => ({
  useBoardMutations: () => ({
    commitTaskMove: vi.fn(),
    moveColumn: vi.fn(),
    seedDefaults: vi.fn(),
    defaultsPending: false,
  }),
}));

vi.mock('./use-board-data', () => ({ useBoardData: vi.fn() }));

const mockedUseBoardData = vi.mocked(useBoardData);

function baseResult(overrides: Partial<UseBoardDataResult>): UseBoardDataResult {
  return {
    board: null,
    columns: [],
    tasks: [],
    members: [],
    labels: [],
    loading: false,
    tasksSyncing: false,
    error: null,
    unavailable: false,
    retry: vi.fn(),
    panelLoading: false,
    panelError: null,
    retryPanelTask: vi.fn(),
    metaRefreshKey: 0,
    columnsRef: { current: [] },
    tasksRef: { current: [] },
    reloadBoardMeta: vi.fn(),
    reloadTasks: vi.fn(),
    reload: vi.fn(),
    setBoard: vi.fn(),
    setColumns: vi.fn(),
    setTasks: vi.fn(),
    setMembers: vi.fn(),
    setLabels: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setMetaRefreshKey: vi.fn(),
    ...overrides,
  };
}

function renderBoard(overrides: Partial<UseBoardDataResult>): void {
  mockedUseBoardData.mockReturnValue(baseResult(overrides));
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardView boardId={BOARD_ID} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Pins the contract the hook and the placeholder only enforce separately: 404/403 leaves the
 * user on the not-found copy with no dead-end button, everything else gets a way to try again.
 * Nothing rendered `BoardView` under test before this — the wiring from `unavailable` to a
 * missing retry control was covered by the hook's own state and a typecheck only.
 */
describe('BoardView load-error contract', () => {
  it('omits Try again and shows the not-found copy for a 404/403 load', () => {
    renderBoard({
      error: "This board doesn't exist, or you don't have access to it.",
      unavailable: true,
    });

    expect(
      screen.getByText("This board doesn't exist, or you don't have access to it."),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to boards' })).toBeDefined();
  });

  it('offers Try again for a transient load failure', () => {
    renderBoard({ error: "The board couldn't load.", unavailable: false });

    expect(screen.getByText("The board couldn't load.")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
