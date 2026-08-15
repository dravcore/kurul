import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  NotificationType,
  SocketClientEvents,
  SocketEvents,
  type NotificationDto,
} from '@kurultay/shared-types';
import { toast } from 'sonner';
import messages from '@/messages/en.json';
import { NotificationBell } from './notification-bell';

type Ack = (response: { ok: boolean }) => void;
type Listener = (...args: unknown[]) => void;

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const OTHER_WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20';
const READ_AT = '2026-01-02T00:00:00.000Z';

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
const post = vi.fn();
const push = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (url: string, init?: unknown) => get(url, init) as unknown,
    // Spread rather than named parameters: a body-less write is a one-argument call, and
    // padding it to two here would make every assertion carry an `undefined` the real client
    // never sends.
    post: (...args: unknown[]) => post(...args) as unknown,
  },
  getApiBaseUrl: () => 'http://localhost:4000',
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID, bootstrapped: true }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * What the server answers, per URL shape.
 *
 * The dropdown reads three different endpoints in one click-through — the badge's count, the
 * rows, and the task a row points at — so a single `mockResolvedValue` cannot stand in for
 * them. Each test sets the fields it cares about; anything it does not set keeps a default
 * that is valid rather than absent.
 */
let unread = 0;
let rows: NotificationDto[] = [];
let taskLookup: () => Promise<{ boardId: string }> = () => Promise.resolve({ boardId: BOARD_ID });

function unreadCount(count: number): void {
  unread = count;
}

function notification(id: string, overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    type: NotificationType.Mention,
    taskId: TASK_ID,
    activityId: null,
    payload: { title: 'Ship the thing', boardId: BOARD_ID },
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderBell() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationBell />
    </NextIntlClientProvider>,
  );
}

/**
 * The trigger, in either state.
 *
 * By role rather than by label because once the dropdown is open Radix points the menu's
 * `aria-labelledby` back at this button, so a bare label query matches both. `hidden` because
 * the open menu is modal and Radix `aria-hidden`s everything outside it — the badge is still
 * on screen and still the thing under test, so a query that drops it would only be measuring
 * whether the menu happens to be open.
 */
function bell(): HTMLElement {
  return screen.getByRole('button', { name: 'Notifications', hidden: true });
}

/** The badge is the only element inside the trigger that carries the number. */
async function expectBadge(text: string): Promise<void> {
  await waitFor(() => {
    expect(bell().textContent).toContain(text);
  });
}

/**
 * The first row, or a failure naming the empty list.
 *
 * `list[0]` is `T | undefined` under this repo's `noUncheckedIndexedAccess`, and the honest
 * way through it is the rule review already asks for: prove the list is not empty before
 * asserting anything about what is in it.
 */
function first<T>(list: T[]): T {
  const [head] = list;
  if (!head) throw new Error('expected at least one element, got an empty list');
  return head;
}

/** Radix opens the dropdown on pointerdown, not on click. */
async function openDropdown(): Promise<HTMLElement[]> {
  fireEvent.pointerDown(bell(), { button: 0, ctrlKey: false });
  return screen.findAllByRole('menuitem');
}

beforeEach(() => {
  listeners.clear();
  emit.mockClear();
  get.mockReset();
  post.mockReset();
  push.mockReset();
  vi.mocked(toast.error).mockClear();
  fakeSocket.connected = false;
  unread = 0;
  rows = [];
  taskLookup = () => Promise.resolve({ boardId: BOARD_ID });

  get.mockImplementation((url: string) => {
    if (url.includes('/notifications/unread-count')) return Promise.resolve({ count: unread });
    if (url.includes('/notifications?')) return Promise.resolve({ items: rows, nextCursor: null });
    if (url.includes('/tasks/')) return taskLookup();
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  post.mockImplementation((url: string) => {
    if (url.endsWith('/read-all')) return Promise.resolve(undefined);
    const id = url.split('/notifications/')[1]?.replace('/read', '') ?? '';
    return Promise.resolve(notification(id, { readAt: READ_AT }));
  });
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

/**
 * The click-through QA-04 found untested: what the dropdown does to the badge, to the row, and
 * to the address bar. `notification-actions` and `notification-nav` are the real modules here —
 * stubbing them would leave the two branches that matter (no board on the payload, and a task
 * that no longer exists) covered nowhere but in their own unit tests.
 */
describe('NotificationBell dropdown', () => {
  it('marks a notification read and lands on its task', async () => {
    unreadCount(2);
    rows = [notification('n1'), notification('n2', { readAt: READ_AT })];
    renderBell();
    fireConnect();
    await expectBadge('2');

    const items = await openDropdown();
    expect(items).toHaveLength(2);
    fireEvent.click(first(items));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`);
    });
    expect(post).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/notifications/n1/read`);
    // One fewer unread, without asking the server for a count it already knows.
    await expectBadge('1');
  });

  /**
   * A notification outlives the task it points at. The row is still marked read — the user
   * read it — but the app has to say the task is gone rather than leave the click looking
   * like it did nothing.
   */
  it('says the task is gone instead of navigating nowhere', async () => {
    unreadCount(1);
    rows = [notification('n1', { payload: { title: 'Deleted task' } })];
    taskLookup = () => Promise.reject(new Error('404'));
    renderBell();
    fireConnect();
    await expectBadge('1');

    const items = await openDropdown();
    expect(items).toHaveLength(1);
    fireEvent.click(first(items));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.openTaskError);
    });
    expect(push).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/notifications/n1/read`);
  });

  /** Clicking a row the user already read is a navigation, not a second write. */
  it('opens an already-read notification without writing to it again', async () => {
    unreadCount(1);
    rows = [notification('n1', { readAt: READ_AT }), notification('n2')];
    renderBell();
    fireConnect();
    await expectBadge('1');

    const items = await openDropdown();
    expect(items).toHaveLength(2);
    fireEvent.click(first(items));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`);
    });
    expect(post).not.toHaveBeenCalled();
    // Nothing became read, so the count must not move.
    await expectBadge('1');
  });

  /** Three digits do not fit next to a bell, and an exact 137 is not what the user needs. */
  it('caps the badge rather than growing it', async () => {
    unreadCount(137);
    renderBell();
    fireConnect();

    await expectBadge(messages.app.notifications.badgeOverflow);
  });

  it('empties the badge when everything is marked read at once', async () => {
    unreadCount(2);
    // Mixed on purpose: mark-all has to leave the row that was already read exactly as it is.
    rows = [notification('n1'), notification('n2', { readAt: READ_AT }), notification('n3')];
    renderBell();
    fireConnect();
    await expectBadge('2');

    const items = await openDropdown();
    expect(items).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: messages.app.notifications.markAllRead }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/notifications/read-all`);
    });
    await waitFor(() => expect(bell().textContent).toBe(''));
  });

  /** A badge that empties on a write the server rejected is a lie the user cannot see. */
  it('keeps the badge when marking everything read fails', async () => {
    unreadCount(3);
    rows = [notification('n1')];
    renderBell();
    fireConnect();
    await expectBadge('3');
    await openDropdown();

    post.mockRejectedValue(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: messages.app.notifications.markAllRead }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.markReadError);
    });
    await expectBadge('3');
  });

  it('reports a read that could not be recorded, and does not navigate on it', async () => {
    unreadCount(1);
    rows = [notification('n1')];
    renderBell();
    fireConnect();
    await expectBadge('1');
    const items = await openDropdown();
    expect(items).toHaveLength(1);

    post.mockRejectedValue(new Error('network'));
    fireEvent.click(first(items));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.markReadError);
    });
    expect(push).not.toHaveBeenCalled();
    await expectBadge('1');
  });

  it('does not offer mark-all-read when nothing is unread', async () => {
    unreadCount(0);
    rows = [notification('n1', { readAt: READ_AT })];
    renderBell();
    fireConnect();
    await openDropdown();

    expect(
      screen.getByRole('button', { name: messages.app.notifications.markAllRead }),
    ).toHaveProperty('disabled', true);
  });
});
