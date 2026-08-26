import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type LabelDto, type WorkspaceMemberDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';
import { useTaskMetadata } from './use-task-metadata';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/member-query', () => ({ fetchAllWorkspaceMembers: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const apiGet = vi.mocked(api.get);
const fetchMembers = vi.mocked(fetchAllWorkspaceMembers);

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

function label(id: string): LabelDto {
  return { id, boardId: BOARD_ID, name: id, color: 'slot-1' };
}

function comment(id: string): unknown {
  return {
    id,
    taskId: TASK_ID,
    authorId: 'user-a',
    authorName: 'A',
    body: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Comments/activities always answer; members and labels only when not supplied as props. */
function stubMeta(overrides: { commentsCursor?: string | null } = {}): void {
  fetchMembers.mockResolvedValue([member('m1')]);
  apiGet.mockImplementation((path: string) => {
    if (path.includes('/comments')) {
      return Promise.resolve({
        items: [comment('c1')],
        nextCursor: overrides.commentsCursor ?? null,
        hasMore: overrides.commentsCursor != null,
      }) as never;
    }
    if (path.includes('/activities')) {
      return Promise.resolve({ items: [{ id: 'a1' }], nextCursor: null, hasMore: false }) as never;
    }
    if (path.endsWith('/labels')) return Promise.resolve([label('l1')]) as never;
    throw new Error(`unexpected request: ${path}`);
  });
}

function renderMeta(props: Partial<Parameters<typeof useTaskMetadata>[0]> = {}) {
  return renderHook(
    (overrides: Partial<Parameters<typeof useTaskMetadata>[0]>) =>
      useTaskMetadata({
        workspaceId: WORKSPACE_ID,
        boardId: BOARD_ID,
        taskId: TASK_ID,
        ...props,
        ...overrides,
      }),
    {
      initialProps: {},
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  apiGet.mockReset();
  fetchMembers.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useTaskMetadata', () => {
  it('loads all four lists in one round and clears the loading flag once', async () => {
    stubMeta();
    const { result } = renderMeta();

    expect(result.current.loadingMeta).toBe(true);
    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    expect(result.current.members.map((entry) => entry.id)).toEqual(['m1']);
    expect(result.current.boardLabels.map((entry) => entry.id)).toEqual(['l1']);
    expect(result.current.comments.map((entry) => entry.id)).toEqual(['c1']);
    expect(result.current.activities).toHaveLength(1);
  });

  it('reads nothing until there is a task to read about', async () => {
    // The panel opens before the board has fetched a deep-linked task, and it owns this read for
    // both of the sections that show it. Firing it against a task id that is not there yet would
    // spend a round of requests on `/tasks/null/comments`.
    stubMeta();
    const { rerender, result } = renderMeta({ taskId: null });

    expect(apiGet).not.toHaveBeenCalled();
    expect(fetchMembers).not.toHaveBeenCalled();

    rerender({ taskId: TASK_ID });

    await waitFor(() => expect(result.current.comments.map((entry) => entry.id)).toEqual(['c1']));
  });

  /** The one guard that is easy to forget: a panel that closes mid-load must not write back. */
  it('aborts the in-flight load on unmount', async () => {
    stubMeta();
    const { unmount } = renderMeta();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const signal = (apiGet.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('skips the members and labels requests when the board already has them', async () => {
    stubMeta();
    const { result } = renderMeta({ members: [member('shared')], labels: [label('shared')] });

    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    expect(fetchMembers).not.toHaveBeenCalled();
    const paths = apiGet.mock.calls.map((call) => call[0]);
    expect(paths.some((path) => (path as string).endsWith('/labels'))).toBe(false);
    expect(result.current.members.map((entry) => entry.id)).toEqual(['shared']);
  });

  /**
   * The comment thread failing is not a reason for the assignee picker to go empty — those
   * people came from the board, and they are still there.
   */
  it('falls back to the board caches when the load fails', async () => {
    fetchMembers.mockResolvedValue([]);
    apiGet.mockRejectedValue(new Error('network'));
    const { result } = renderMeta({ members: [member('shared')], labels: [label('shared')] });

    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    expect(result.current.members.map((entry) => entry.id)).toEqual(['shared']);
    expect(result.current.comments).toEqual([]);
    expect(result.current.hasMoreComments).toBe(false);
  });

  /**
   * The empty arrays above are the fallback, not an answer — the panel has to be able to tell
   * them from a thread that really is empty, or it says "No comments yet" about comments it
   * never managed to read.
   */
  it('says the load failed rather than leaving the empty lists to speak for it', async () => {
    fetchMembers.mockResolvedValue([]);
    apiGet.mockRejectedValue(new Error('network'));
    const { result } = renderMeta({ members: [member('shared')], labels: [label('shared')] });

    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    expect(result.current.metaFailed).toBe(true);
  });

  it('leaves the failure flag down when the load succeeds', async () => {
    stubMeta();
    const { result } = renderMeta();

    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    expect(result.current.metaFailed).toBe(false);
  });

  it('refetches when metaRefreshKey is bumped', async () => {
    stubMeta();
    const { result, rerender } = renderMeta();
    await waitFor(() => expect(result.current.loadingMeta).toBe(false));
    const before = apiGet.mock.calls.length;

    rerender({ metaRefreshKey: 1 });

    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(before));
  });

  it('edits one list without disturbing the others', async () => {
    stubMeta();
    const { result } = renderMeta();
    await waitFor(() => expect(result.current.loadingMeta).toBe(false));

    act(() => result.current.setBoardLabels((current) => [...current, label('l2')]));

    expect(result.current.boardLabels.map((entry) => entry.id)).toEqual(['l1', 'l2']);
    expect(result.current.comments.map((entry) => entry.id)).toEqual(['c1']);
    expect(result.current.activities).toHaveLength(1);
  });

  it('appends the next comment page and drops rows it already shows', async () => {
    stubMeta({ commentsCursor: 'cursor-1' });
    const { result } = renderMeta();
    await waitFor(() => expect(result.current.loadingMeta).toBe(false));
    expect(result.current.hasMoreComments).toBe(true);

    apiGet.mockImplementation(
      () =>
        Promise.resolve({
          items: [comment('c1'), comment('c2')],
          nextCursor: null,
          hasMore: false,
        }) as never,
    );
    await act(async () => {
      await result.current.loadMoreComments();
    });

    expect(result.current.comments.map((entry) => entry.id)).toEqual(['c1', 'c2']);
    expect(result.current.hasMoreComments).toBe(false);
  });
});
