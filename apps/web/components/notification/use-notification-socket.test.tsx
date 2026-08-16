import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SocketClientEvents } from '@kurul/shared-types';
import { useNotificationSocket } from './use-notification-socket';

type Ack = (response: { ok: boolean }) => void;
type Listener = (...args: unknown[]) => void;

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const listeners = new Map<string, Set<Listener>>();
let joinAck: { ok: boolean } = { ok: true };
const emit = vi.fn((event: string, _payload: unknown, ack?: Ack) => {
  if (event === SocketClientEvents.NOTIFICATIONS_JOIN) ack?.(joinAck);
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

vi.mock('@/lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

function fireConnect(): void {
  act(() => {
    fakeSocket.connected = true;
    for (const handler of listeners.get('connect') ?? []) handler();
  });
}

function renderSubscriber() {
  const onUnreadChanged = vi.fn();
  const onResync = vi.fn();
  const view = renderHook(() =>
    useNotificationSocket(WORKSPACE_ID, true, { onUnreadChanged, onResync }),
  );
  return { ...view, onUnreadChanged, onResync };
}

function leaveCalls(): unknown[][] {
  return emit.mock.calls.filter((call) => call[0] === SocketClientEvents.NOTIFICATIONS_LEAVE);
}

beforeEach(() => {
  listeners.clear();
  emit.mockClear();
  fakeSocket.connected = false;
  joinAck = { ok: true };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useNotificationSocket room lifetime', () => {
  it('keeps the room while another subscriber still holds it', () => {
    // The bell lives in the app shell; the notifications page mounts inside it.
    const bell = renderSubscriber();
    const page = renderSubscriber();
    fireConnect();

    page.unmount();
    // Leaving here would silence the bell, which would keep looking perfectly healthy.
    expect(leaveCalls()).toHaveLength(0);

    bell.unmount();
    expect(leaveCalls()).toEqual([
      [SocketClientEvents.NOTIFICATIONS_LEAVE, { workspaceId: WORKSPACE_ID }],
    ]);
  });

  it('reports connected only once the room join is acked', () => {
    joinAck = { ok: false };
    const denied = renderSubscriber();

    fireConnect();

    // A socket that connected but was refused the room delivers nothing — the caller has to
    // keep its fallback refresh running.
    expect(denied.result.current.connected).toBe(false);
    expect(denied.onResync).not.toHaveBeenCalled();

    denied.unmount();
    joinAck = { ok: true };
    fakeSocket.connected = false;
    const joined = renderSubscriber();
    fireConnect();

    expect(joined.result.current.connected).toBe(true);
    expect(joined.onResync).toHaveBeenCalledTimes(1);
  });
});
