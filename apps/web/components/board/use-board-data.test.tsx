import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  MemberRole,
  Priority,
  type TaskDto,
  type WorkspaceMemberDto,
} from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import type { BoardTaskFilters, BoardTaskPage, FetchBoardTasksOptions } from '@/lib/task-query';
import { fetchAllBoardTasks } from '@/lib/task-query';
import { useBoardData } from './use-board-data';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/lib/task-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-query')>();
  return { ...actual, fetchAllBoardTasks: vi.fn() };
});

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID }),
}));

const apiGet = vi.mocked(api.get);
const drain = vi.mocked(fetchAllBoardTasks);

function task(id: string): TaskDto {
  return {
    id,
    boardId: BOARD_ID,
    columnId: 'column-1',
    title: id,
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
  };
}

function member(id: string): WorkspaceMemberDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: `user-${id}`,
    role: MemberRole.MEMBER,
    name: `Member ${id}`,
    avatarUrl: null,
  };
}

function metaResponse(path: string): unknown {
  if (path.endsWith('/columns')) {
    return [{ id: 'column-1', boardId: BOARD_ID, name: 'To Do', position: 1 }];
  }
  // The roster is a cursor page; the drain lives in `lib/member-query`.
  if (path.includes('/members')) return { items: [], nextCursor: null, hasMore: false };
  if (path.endsWith('/labels')) return [];
  return { id: BOARD_ID, name: 'Board' };
}

/** Meta endpoints all resolve; only the task drain is interesting here. */
function stubMeta(): void {
  // `api.get` is generic over its response, which a single double cannot satisfy.
  apiGet.mockImplementation((path: string) => Promise.resolve(metaResponse(path)) as never);
}

/** Stable identity: the hook re-runs its load effect whenever `filters` changes. */
const NO_FILTERS: BoardTaskFilters = {};

function renderBoardData(selectedTaskId: string | null = null) {
  return renderHook(() => useBoardData(BOARD_ID, NO_FILTERS, selectedTaskId), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

beforeEach(() => {
  apiGet.mockReset();
  drain.mockReset();
  stubMeta();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBoardData task streaming', () => {
  it('paints the board on the first page and appends the rest behind it', async () => {
    let releaseSecondPage = (): void => {};
    const secondPage = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      const first: BoardTaskPage = { items: [task('a')], index: 0, hasMore: true };
      options?.onPage?.(first);
      await secondPage;
      const second: BoardTaskPage = { items: [task('b')], index: 1, hasMore: false };
      options?.onPage?.(second);
      return [...first.items, ...second.items];
    });

    const { result } = renderBoardData();

    // The skeleton is gone once the frame and page 0 are in, not when the drain ends.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['a']);
    expect(result.current.tasksSyncing).toBe(true);

    releaseSecondPage();

    await waitFor(() => expect(result.current.tasksSyncing).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps a locally patched row when a later page lands', async () => {
    let releaseSecondPage = (): void => {};
    const secondPage = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('a')], index: 0, hasMore: true });
      await secondPage;
      // Page 1 repeats `a` (the API re-paged around it) and brings `b`.
      options?.onPage?.({ items: [task('a'), task('b')], index: 1, hasMore: false });
      return [task('a'), task('b')];
    });

    const { result } = renderBoardData();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Stands in for an optimistic drag landing mid-drain.
    act(() => {
      result.current.setTasks((current) =>
        current.map((item) => (item.id === 'a' ? { ...item, position: 42 } : item)),
      );
    });
    await waitFor(() => expect(result.current.tasks[0]?.position).toBe(42));

    releaseSecondPage();

    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(result.current.tasks[0]?.position).toBe(42);
  });

  /**
   * The assignee filter and the assignee picker both filter this list locally, so a roster
   * that stopped at page one would quietly hide the people on page two.
   */
  it('loads the whole roster, not just the first member page', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.includes('/members')) {
        return Promise.resolve(
          path.includes('cursor=cursor-1')
            ? { items: [member('b')], nextCursor: null, hasMore: false }
            : { items: [member('a')], nextCursor: 'cursor-1', hasMore: true },
        ) as never;
      }
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.members).toHaveLength(2));
    expect(result.current.members.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('reports the load error when the drain fails', async () => {
    drain.mockRejectedValue(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));
    expect(result.current.loading).toBe(false);
  });
});

/** A task reached by URL that the board's own pages never brought back — filtered, or deleted. */
describe('useBoardData deep-linked task', () => {
  it('fetches the missing task and adds it to the board', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return Promise.resolve(task('task-9')) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.tasks.map((item) => item.id)).toEqual(['task-9']));
    expect(result.current.panelError).toBeNull();
  });

  /** The lookup must be abortable like every other read here — it used to be the one that was not. */
  it('passes an abort signal with the lookup', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return new Promise(() => {}) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { unmount } = renderBoardData('task-9');

    await waitFor(() =>
      expect(apiGet.mock.calls.some((call) => (call[0] as string).endsWith('/tasks/task-9'))).toBe(
        true,
      ),
    );
    const lookup = apiGet.mock.calls.find((call) => (call[0] as string).endsWith('/tasks/task-9'));
    const signal = (lookup?.[1] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('reports a task the API cannot produce', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return Promise.reject(new Error('404')) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.panelError).not.toBeNull());
    expect(result.current.tasks).toEqual([]);
  });

  it('asks for nothing when the board already has the task', async () => {
    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('task-9')], index: 0, hasMore: false });
      return [task('task-9')];
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiGet.mock.calls.some((call) => (call[0] as string).endsWith('/tasks/task-9'))).toBe(
      false,
    );
    expect(result.current.panelError).toBeNull();
  });
});
