import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_COLUMNS, type ColumnDto, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { useBoardMutations } from './use-board-mutations';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { post: vi.fn(), patch: vi.fn() } };
});

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const apiPost = vi.mocked(api.post);

function renderMutations() {
  const columnsRef = { current: [] as ColumnDto[] };
  const tasksRef = { current: [] as TaskDto[] };
  const setColumns = vi.fn();
  const reload = vi.fn().mockResolvedValue(undefined);

  const view = renderHook(
    () =>
      useBoardMutations({
        boardId: BOARD_ID,
        columnsRef,
        tasksRef,
        setColumns,
        setTasks: vi.fn(),
        reload,
      }),
    {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );

  return { ...view, setColumns, reload };
}

/** Each create answers with a column whose id is the name, so ordering is readable. */
function stubCreates(): void {
  apiPost.mockImplementation(
    (_path: string, body?: unknown) =>
      Promise.resolve({
        id: (body as { name: string }).name,
        boardId: BOARD_ID,
        name: (body as { name: string }).name,
        position: 0,
      }) as never,
  );
}

beforeEach(() => {
  apiPost.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBoardMutations seedDefaults', () => {
  it('seeds exactly the shared default columns, in order', async () => {
    stubCreates();
    const { result } = renderMutations();

    await result.current.seedDefaults();

    const names = apiPost.mock.calls.map((call) => (call[1] as { name: string }).name);
    expect(names).toEqual(DEFAULT_COLUMNS.map((column) => column.name));
    for (const call of apiPost.mock.calls) {
      expect(call[0]).toBe(`/workspaces/${WORKSPACE_ID}/boards/${BOARD_ID}/columns`);
    }
  });

  it('sends each column its category, not just its name', async () => {
    stubCreates();
    const { result } = renderMutations();

    await result.current.seedDefaults();

    const categories = apiPost.mock.calls.map(
      (call) => (call[1] as { category?: string }).category,
    );
    // Spelled out rather than mapped from DEFAULT_COLUMNS: a Done column seeded without
    // COMPLETED reports zero throughput forever, and asserting against the same constant the
    // code reads would not notice.
    expect(categories).toEqual(['UNSTARTED', 'STARTED', 'COMPLETED']);
  });

  /**
   * The order is carried by `afterColumnId`, not by request order — the server owns the
   * Float each column lands on, so an omitted anchor would append wherever it liked.
   */
  it('anchors each column after the one before it', async () => {
    stubCreates();
    const { result } = renderMutations();

    await result.current.seedDefaults();

    const anchors = apiPost.mock.calls.map(
      (call) => (call[1] as { afterColumnId?: string }).afterColumnId,
    );
    const names = DEFAULT_COLUMNS.map((column) => column.name);
    expect(anchors).toEqual([undefined, ...names.slice(0, -1)]);
  });

  it('keeps the columns that were created when a later one fails', async () => {
    const [first] = DEFAULT_COLUMNS;
    apiPost
      .mockResolvedValueOnce({
        id: 'c1',
        boardId: BOARD_ID,
        name: first?.name ?? '',
        position: 1000,
      } as never)
      .mockRejectedValueOnce(new Error('network'));

    const { result, setColumns, reload } = renderMutations();

    await result.current.seedDefaults();

    expect(setColumns).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1' })]);
    // A partial seed is refetched rather than guessed at — see the hook's docstring.
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
