import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { TaskDto } from '@kurultay/shared-types';
import { SocketClientEvents } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { useBoardRealtime } from './use-board-realtime';

type Ack = (response: { ok: boolean }) => void;
type Listener = (...args: unknown[]) => void;

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

/** Minimal socket double: enough to fire `connect` and ack a room join. */
const listeners = new Map<string, Set<Listener>>();
const emit = vi.fn((event: string, _payload: unknown, ack?: Ack) => {
  if (event === SocketClientEvents.BOARD_JOIN) ack?.({ ok: true });
});

const fakeSocket = {
  connected: false,
  emit,
  on: (event: string, handler: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(handler);
    listeners.set(event, set);
  },
  off: (event: string, handler: Listener) => {
    listeners.get(event)?.delete(handler);
  },
  connect: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
};

function fireConnect(): void {
  act(() => {
    fakeSocket.connected = true;
    for (const handler of listeners.get('connect') ?? []) handler();
  });
}

vi.mock('@/lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID }),
}));

function renderRealtime(reload: () => Promise<void>) {
  const tasksRef = { current: [] as TaskDto[] };
  return renderHook(
    () =>
      useBoardRealtime({
        boardId: BOARD_ID,
        loading: false,
        currentUserId: null,
        selectedTaskId: null,
        dndRef: { current: null },
        tasksRef,
        setTasks: vi.fn(),
        setColumns: vi.fn(),
        setMetaRefreshKey: vi.fn(),
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
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners.clear();
  emit.mockClear();
  fakeSocket.connected = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBoardRealtime resync', () => {
  it('does not re-drain the board for the join that follows the first load', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    renderRealtime(reload);

    fireConnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(emit).toHaveBeenCalledWith(
      SocketClientEvents.BOARD_JOIN,
      { boardId: BOARD_ID },
      expect.any(Function),
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('coalesces a burst of reconnects into a single drain', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    renderRealtime(reload);

    // Move past the freshness window so the joins are treated as real resyncs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    fireConnect();
    fireConnect();
    fireConnect();
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not stack a second drain on top of one already running', async () => {
    let finishReload = (): void => {};
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReload = () => resolve();
        }),
    );
    renderRealtime(reload);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    fireConnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);

    // A reconnect while the drain is in flight is remembered, not run in parallel.
    fireConnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishReload();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // The queued trigger is dropped too: the drain that just finished started after it.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('drops a pending resync when the board unmounts', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderRealtime(reload);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireConnect();
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
