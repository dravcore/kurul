import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { SocketClientEvents, SocketEvents } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { NotificationBell } from './notification-bell';

type Ack = (response: { ok: boolean }) => void;
type Listener = (...args: unknown[]) => void;

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const OTHER_WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02';

/** Minimal socket double: enough to fire `connect`, ack a room join and push an event. */
const listeners = new Map<string, Set<Listener>>();
const emit = vi.fn((event: string, _payload: unknown, ack?: Ack) => {
  if (event === SocketClientEvents.NOTIFICATIONS_JOIN) ack?.({ ok: true });
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

function fire(event: string, payload?: unknown): void {
  act(() => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  });
}

function fireConnect(): void {
  act(() => {
    fakeSocket.connected = true;
    for (const handler of listeners.get('connect') ?? []) handler();
  });
}

function fireDisconnect(): void {
  act(() => {
    fakeSocket.connected = false;
    for (const handler of listeners.get('disconnect') ?? []) handler();
  });
}

const get = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (url: string, init?: unknown) => get(url, init) as unknown,
  },
  getApiBaseUrl: () => 'http://localhost:4000',
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID, bootstrapped: true }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function unreadCount(count: number): void {
  get.mockResolvedValue({ count });
}

function renderBell() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationBell />
    </NextIntlClientProvider>,
  );
}

/** The badge is the only element inside the trigger that carries the number. */
async function expectBadge(text: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText('Notifications').textContent).toContain(text);
  });
}

beforeEach(() => {
  listeners.clear();
  emit.mockClear();
  get.mockReset();
  fakeSocket.connected = false;
  unreadCount(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NotificationBell realtime badge', () => {
  it('joins the notification room with the workspace only — never a user id', async () => {
    unreadCount(1);
    renderBell();
    fireConnect();

    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith(
        SocketClientEvents.NOTIFICATIONS_JOIN,
        { workspaceId: WORKSPACE_ID },
        expect.any(Function),
      );
    });
    // The recipient is whoever the session says it is; nothing about it travels from here.
    const joinPayload = emit.mock.calls.find(
      (call) => call[0] === SocketClientEvents.NOTIFICATIONS_JOIN,
    )?.[1];
    expect(joinPayload).toEqual({ workspaceId: WORKSPACE_ID });
  });

  it('refreshes the badge when the unread signal arrives', async () => {
    unreadCount(1);
    renderBell();
    fireConnect();
    await expectBadge('1');

    unreadCount(3);
    fire(SocketEvents.NOTIFICATION_UNREAD_CHANGED, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });

    await expectBadge('3');
  });

  it('ignores a signal for another workspace', async () => {
    unreadCount(1);
    renderBell();
    fireConnect();
    await expectBadge('1');

    const callsBefore = get.mock.calls.length;
    unreadCount(9);
    fire(SocketEvents.NOTIFICATION_UNREAD_CHANGED, {
      workspaceId: OTHER_WORKSPACE_ID,
      userId: USER_ID,
    });

    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(callsBefore);
    await expectBadge('1');
  });

  it('stops polling once the room is joined', async () => {
    vi.useFakeTimers();
    unreadCount(1);
    renderBell();
    fireConnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterJoin = get.mock.calls.length;

    // Ten minutes on a live socket: the badge is pushed, so nothing is asked for.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(get).toHaveBeenCalledTimes(callsAfterJoin);
  });

  it('refreshes on every re-join, because nothing that happened while down was delivered', async () => {
    unreadCount(1);
    renderBell();
    fireConnect();
    await expectBadge('1');

    fireDisconnect();
    unreadCount(7);
    fireConnect();

    await expectBadge('7');
  });

  /**
   * The badge has nowhere to say "this failed", so a blank one reads as "nothing unread".
   * A count from two minutes ago is the less wrong of the two.
   */
  it('keeps the last known count when a refresh fails', async () => {
    unreadCount(4);
    renderBell();
    fireConnect();
    await expectBadge('4');

    const callsBefore = get.mock.calls.length;
    get.mockRejectedValue(new Error('network'));
    fire(SocketEvents.NOTIFICATION_UNREAD_CHANGED, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });

    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(callsBefore));
    await expectBadge('4');
  });

  it('falls back to polling while the socket is down', async () => {
    vi.useFakeTimers();
    unreadCount(1);
    renderBell();
    fireConnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireDisconnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsWhenDown = get.mock.calls.length;

    // A dead socket delivers nothing, so the timer is what keeps the badge from freezing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(get.mock.calls.length).toBeGreaterThan(callsWhenDown);
  });
});
