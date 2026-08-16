import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDto } from '@kurul/shared-types';
import { fetchWorkspaceBoards } from './workspace-boards';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

const get = vi.mocked(api.get);

const BOARDS = [{ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d71', name: 'Roadmap' }] as BoardDto[];

// The in-flight map is module state that outlives a single test, so each test asks about a
// workspace no other test touched rather than depending on the cleanup order between them.
let workspaceCount = 0;
function nextWorkspaceId(): string {
  workspaceCount += 1;
  return `0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d${workspaceCount.toString().padStart(2, '0')}`;
}

/** Resolves only when told to, and honours an abort signal the way `fetch` would. */
function deferredGet(): { resolve: (boards: BoardDto[]) => void } {
  let settle!: (boards: BoardDto[]) => void;
  get.mockImplementation((_path: string, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      settle = resolve;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  });
  return { resolve: (boards) => settle(boards) };
}

/** Lets the `queueMicrotask` that clears the in-flight entry run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  get.mockReset();
});

describe('fetchWorkspaceBoards', () => {
  it('serves concurrent callers from one request', async () => {
    const workspaceId = nextWorkspaceId();
    const pending = deferredGet();

    const first = fetchWorkspaceBoards(workspaceId);
    const second = fetchWorkspaceBoards(workspaceId);
    pending.resolve(BOARDS);

    await expect(first).resolves.toEqual(BOARDS);
    await expect(second).resolves.toEqual(BOARDS);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(`/workspaces/${workspaceId}/boards`);
  });

  it('keeps workspaces apart', async () => {
    get.mockResolvedValue(BOARDS);

    await Promise.all([
      fetchWorkspaceBoards(nextWorkspaceId()),
      fetchWorkspaceBoards(nextWorkspaceId()),
    ]);

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh request once the shared one has settled', async () => {
    const workspaceId = nextWorkspaceId();
    get.mockResolvedValue(BOARDS);

    await fetchWorkspaceBoards(workspaceId);
    await flushMicrotasks();
    await fetchWorkspaceBoards(workspaceId);

    expect(get).toHaveBeenCalledTimes(2);
  });

  /**
   * The StrictMode double-effect: the first subscriber mounts, is torn down and aborts its
   * own controller, then remounts alongside a sibling list. Both join the same in-flight
   * entry, and neither of them asked to be cancelled — so the shared promise must not carry
   * the departed subscriber's abort.
   */
  it('survives the first subscriber aborting while others still want the result', async () => {
    const workspaceId = nextWorkspaceId();
    const pending = deferredGet();

    // Each subscriber owns a controller, exactly as `useApiResource` does, and the fetcher it
    // builds must not hand that controller to the shared request.
    const subscribe = (): { outcome: Promise<string>; controller: AbortController } => {
      const controller = new AbortController();
      const outcome = fetchWorkspaceBoards(workspaceId).then(
        () => 'resolved',
        (caught: unknown) => `rejected: ${(caught as Error).name}`,
      );
      return { outcome, controller };
    };

    const abandoned = subscribe();
    abandoned.controller.abort();

    const remounted = subscribe();
    const sibling = subscribe();
    pending.resolve(BOARDS);

    await expect(remounted.outcome).resolves.toBe('resolved');
    await expect(sibling.outcome).resolves.toBe('resolved');
    await expect(abandoned.outcome).resolves.toBe('resolved');
    expect(get).toHaveBeenCalledTimes(1);
  });

  /**
   * The invariant behind the test above, stated where a refactor will trip over it: a shared
   * promise cannot carry any one subscriber's cancellation, so nothing reaches `api.get`
   * that could abort it.
   */
  it('never passes an abort signal to the shared request', async () => {
    const workspaceId = nextWorkspaceId();
    get.mockResolvedValue(BOARDS);

    await fetchWorkspaceBoards(workspaceId);

    expect(get.mock.calls[0]).toEqual([`/workspaces/${workspaceId}/boards`]);
  });
});
