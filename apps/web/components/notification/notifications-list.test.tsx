import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationType, type NotificationDto } from '@kurul/shared-types';
import { toast } from 'sonner';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { NotificationBell } from './notification-bell';
import { NotificationUnreadProvider } from './notification-unread-provider';
import { NotificationsList } from './notifications-list';

// `@/lib/notification-actions` and `@/lib/notification-nav` are deliberately real: what this
// screen does to a notification *is* those two modules, and stubbing them would leave the
// click-through asserting only that a mock was called.
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/**
 * The socket is stubbed, but its callbacks are kept: they are how a notification that arrives
 * while this page is open reaches it, and a stub that dropped them would silently delete that
 * behaviour from the suite.
 */
interface SocketHandlers {
  onUnreadChanged: () => void;
  onResync: () => void;
}
let socketHandlers: SocketHandlers | null = null;
vi.mock('./use-notification-socket', () => ({
  useNotificationSocket: (_workspaceId: unknown, _enabled: unknown, handlers: SocketHandlers) => {
    socketHandlers = handlers;
    return { connected: true };
  },
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: 'w1', activeRole: null, bootstrapped: true }),
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20';
const READ_AT = '2026-01-02T00:00:00.000Z';

function notification(id: string, overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id,
    workspaceId: 'w1',
    userId: 'u1',
    type: NotificationType.Mention,
    taskId: TASK_ID,
    activityId: null,
    payload: { title: 'Ship the thing', boardId: BOARD_ID },
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The page the next list request answers with, keyed by nothing — tests set it per call. */
let listPages: { items: NotificationDto[]; nextCursor: string | null }[] = [];
/** What the server says is unread, for the tests that mount the bell alongside the page. */
let unread = 0;
let taskLookup: () => Promise<{ boardId: string }> = () => Promise.resolve({ boardId: BOARD_ID });
/** Every list URL the screen asked for, in order — the filters are only visible here. */
let listUrls: string[] = [];

function serveList(...pages: { items: NotificationDto[]; nextCursor: string | null }[]): void {
  listPages = pages;
}

/**
 * The page as the shell mounts it: inside the provider that owns the unread count. Real rather
 * than stubbed, so the count this screen writes to is the same object the badge reads.
 */
function renderInShell(content: React.ReactNode): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationUnreadProvider>{content}</NotificationUnreadProvider>
    </NextIntlClientProvider>,
  );
}

function renderList(): void {
  renderInShell(<NotificationsList />);
}

/**
 * The page with the bell beside it. Two separate subtrees in the real app (the bell sits in the
 * sidebar, the page in `main`), which is the whole reason the count is held above both.
 */
function renderListWithBell(): void {
  renderInShell(
    <>
      <NotificationBell />
      <NotificationsList />
    </>,
  );
}

function bell(): HTMLElement {
  return screen.getByRole('button', { name: messages.app.notifications.open });
}

function rows(): HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => button.querySelector('time') !== null);
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

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  push.mockReset();
  vi.mocked(toast.error).mockClear();
  socketHandlers = null;
  listUrls = [];
  listPages = [{ items: [], nextCursor: null }];
  unread = 0;
  taskLookup = () => Promise.resolve({ boardId: BOARD_ID });

  apiGet.mockImplementation(((url: string) => {
    if (url.includes('/tasks/')) return taskLookup();
    // Answered before `listUrls` is written, so the badge's read stays out of the list of URLs
    // this screen asked for.
    if (url.includes('/notifications/unread-count')) return Promise.resolve({ count: unread });
    listUrls.push(url);
    return Promise.resolve(listPages.length > 1 ? listPages.shift() : listPages[0]);
  }) as never);
  apiPost.mockImplementation(((url: string) => {
    if (url.endsWith('/read-all')) return Promise.resolve(undefined);
    const id = url.split('/notifications/')[1]?.replace('/read', '') ?? '';
    return Promise.resolve(notification(id, { readAt: READ_AT }));
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NotificationsList', () => {
  it('lists the notifications it loaded', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();

    expect(await screen.findByText(/mentioned/i)).toBeDefined();
  });

  it('says it is empty only when the load succeeded and returned nothing', async () => {
    serveList({ items: [], nextCursor: null });
    renderList();

    expect(await screen.findByText(messages.app.notifications.empty)).toBeDefined();
  });

  /**
   * The bug this screen shipped with: the failed load resets the page to `EMPTY_PAGE`, and
   * without reading `error` the empty branch tells the user they are caught up — while an
   * unread notification is sitting on the server. The toast that used to be the only signal
   * disappears, and what stays on the page is the wrong answer.
   */
  it('reports a failed load instead of claiming there is nothing to read', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    renderList();

    expect(await screen.findByText(messages.app.notifications.loadError)).toBeDefined();
    expect(screen.queryByText(messages.app.notifications.empty)).toBeNull();
  });

  it('offers a retry that refetches the first page', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    renderList();
    await screen.findByText(messages.app.notifications.loadError);
    const calls = apiGet.mock.calls.length;

    apiGet.mockResolvedValue({ items: [notification('n1')], nextCursor: null } as never);
    screen.getByRole('button', { name: messages.app.errors.retry }).click();

    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText(/mentioned/i)).toBeDefined();
  });

  /** Every notification type has to read as what it is; an unknown one must not render blank. */
  it('names what each row is about', async () => {
    serveList({
      items: [
        notification('n1', { type: NotificationType.Assignment }),
        notification('n2', { type: NotificationType.Mention }),
        notification('n3', { type: NotificationType.DueSoon }),
        notification('n4', { type: 'invented_later' }),
      ],
      nextCursor: null,
    });
    renderList();

    await screen.findAllByText(/mentioned/i);
    // Asserted before the four lookups below, so none of them can pass against an empty list.
    expect(rows()).toHaveLength(4);
    expect(screen.getByText('Assigned to “Ship the thing”')).toBeDefined();
    expect(screen.getByText('Mentioned on “Ship the thing”')).toBeDefined();
    expect(screen.getByText('Due soon: “Ship the thing”')).toBeDefined();
    expect(screen.getByText('invented_later')).toBeDefined();
  });
});

describe('NotificationsList click-through', () => {
  it('marks a notification read and opens the task it points at', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    const listed = await screen.findAllByText(/mentioned/i);
    expect(listed).toHaveLength(1);

    fireEvent.click(first(listed));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`));
    expect(apiPost).toHaveBeenCalledWith('/workspaces/w1/notifications/n1/read');
  });

  /**
   * The QA-04 case: the notification survived the task. It still marks read — the user read
   * it — but the screen has to say the task is gone rather than look like the click missed.
   */
  it('says the task is gone instead of navigating nowhere', async () => {
    serveList({ items: [notification('n1', { payload: { title: 'Deleted' } })], nextCursor: null });
    taskLookup = () => Promise.reject(new Error('404'));
    renderList();
    const listed = await screen.findAllByText(/mentioned/i);
    expect(listed).toHaveLength(1);

    fireEvent.click(first(listed));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.openTaskError),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('reports a read the server refused, and stays put', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    apiPost.mockRejectedValue(new Error('network'));
    renderList();
    const listed = await screen.findAllByText(/mentioned/i);
    expect(listed).toHaveLength(1);

    fireEvent.click(first(listed));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.markReadError),
    );
    expect(push).not.toHaveBeenCalled();
  });

  /**
   * The row is patched from the server's answer rather than refetched, so the only thing that
   * proves the patch happened is the screen agreeing there is nothing left unread.
   */
  it('stops offering mark-all-read once the last unread row has been read', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    const markAll = await screen.findByRole('button', {
      name: messages.app.notifications.markAllRead,
    });
    expect(markAll).toHaveProperty('disabled', false);
    const listed = screen.getAllByText(/mentioned/i);
    expect(listed).toHaveLength(1);

    fireEvent.click(first(listed));

    await waitFor(() => expect(markAll).toHaveProperty('disabled', true));
    expect(
      apiGet.mock.calls.filter((call) => String(call[0]).includes('/notifications?')),
    ).toHaveLength(1);
  });

  /** A row the user already read is a navigation, not a second write. */
  it('opens an already-read notification without marking it again', async () => {
    serveList({ items: [notification('n1', { readAt: READ_AT })], nextCursor: null });
    renderList();
    const listed = await screen.findAllByText(/mentioned/i);
    expect(listed).toHaveLength(1);

    fireEvent.click(first(listed));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('marks everything read, and then has nothing left to offer', async () => {
    // Mixed on purpose: mark-all has to leave the row that was already read exactly as it is.
    serveList({
      items: [notification('n1'), notification('n2', { readAt: READ_AT })],
      nextCursor: null,
    });
    renderList();
    const markAll = await screen.findByRole('button', {
      name: messages.app.notifications.markAllRead,
    });
    expect(markAll).toHaveProperty('disabled', false);

    fireEvent.click(markAll);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/workspaces/w1/notifications/read-all'),
    );
    // The rows are patched in place, so the button turns itself off without a refetch.
    await waitFor(() => expect(markAll).toHaveProperty('disabled', true));
  });

  it('does not offer mark-all-read when every row is already read', async () => {
    serveList({ items: [notification('n1', { readAt: READ_AT })], nextCursor: null });
    renderList();

    const markAll = await screen.findByRole('button', {
      name: messages.app.notifications.markAllRead,
    });
    expect(markAll).toHaveProperty('disabled', true);
  });

  it('reports a failed mark-all-read and leaves the rows unread', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    apiPost.mockRejectedValue(new Error('network'));
    renderList();
    const markAll = await screen.findByRole('button', {
      name: messages.app.notifications.markAllRead,
    });

    fireEvent.click(markAll);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.markReadError),
    );
    expect(markAll).toHaveProperty('disabled', false);
  });
});

describe('NotificationsList paging and filters', () => {
  it('appends the next page instead of replacing what is on screen', async () => {
    serveList(
      { items: [notification('n1')], nextCursor: 'cursor-1' },
      { items: [notification('n2', { type: NotificationType.DueSoon })], nextCursor: null },
    );
    renderList();
    const loadMore = await screen.findByRole('button', {
      name: messages.app.notifications.loadMore,
    });
    expect(rows()).toHaveLength(1);

    fireEvent.click(loadMore);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(listUrls[1]).toContain('cursor=cursor-1');
    // The first page is still there, which is the whole difference between append and replace.
    expect(screen.getByText('Mentioned on “Ship the thing”')).toBeDefined();
    expect(screen.getByText('Due soon: “Ship the thing”')).toBeDefined();
    // Nothing left to page through, so the button goes away.
    expect(screen.queryByRole('button', { name: messages.app.notifications.loadMore })).toBeNull();
  });

  it('keeps the rows it has when the next page fails', async () => {
    serveList({ items: [notification('n1')], nextCursor: 'cursor-1' });
    renderList();
    const loadMore = await screen.findByRole('button', {
      name: messages.app.notifications.loadMore,
    });
    expect(rows()).toHaveLength(1);

    apiGet.mockRejectedValue(new Error('network'));
    fireEvent.click(loadMore);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.loadError),
    );
    expect(rows()).toHaveLength(1);
  });

  it('asks the server for unread rows only when the user narrows to unread', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    await screen.findAllByText(/mentioned/i);
    expect(listUrls[0]).not.toContain('unreadOnly');

    fireEvent.click(screen.getByLabelText(messages.app.notifications.unreadOnly));

    await waitFor(() => expect(listUrls.length).toBeGreaterThan(1));
    expect(listUrls[listUrls.length - 1]).toContain('unreadOnly=true');
  });

  it('asks the server for one type when the user picks one', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    await screen.findAllByText(/mentioned/i);

    fireEvent.change(screen.getByLabelText(messages.app.notifications.typeFilter), {
      target: { value: NotificationType.DueSoon },
    });

    await waitFor(() => expect(listUrls.length).toBeGreaterThan(1));
    expect(listUrls[listUrls.length - 1]).toContain(`type=${NotificationType.DueSoon}`);
  });
});

describe('NotificationsList realtime', () => {
  it('picks up a notification that arrives while the page is open', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    await screen.findAllByText(/mentioned/i);
    expect(rows()).toHaveLength(1);

    serveList({
      items: [notification('n2', { type: NotificationType.Assignment }), notification('n1')],
      nextCursor: null,
    });
    act(() => socketHandlers?.onUnreadChanged());

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText('Assigned to “Ship the thing”')).toBeDefined();
  });

  /**
   * The first join lands right after the initial load, which already returned fresh rows.
   * Refetching on it would double every page load; refetching on the *second* one is what
   * closes the gap a dropped connection opened.
   */
  it('ignores the first room join and refreshes on a later one', async () => {
    serveList({ items: [notification('n1')], nextCursor: null });
    renderList();
    await screen.findAllByText(/mentioned/i);
    const afterLoad = listUrls.length;

    act(() => socketHandlers?.onResync());
    expect(listUrls).toHaveLength(afterLoad);

    act(() => socketHandlers?.onResync());
    await waitFor(() => expect(listUrls.length).toBeGreaterThan(afterLoad));
  });
});

/**
 * The bug this pairing exists for: mark-all-read used to patch only the rows this screen had
 * loaded, while the badge counted every unread row on the server. The user cleared the page and
 * the bell went on showing a number, until a socket signal or the two-minute fallback poll
 * happened to correct it.
 */
describe('NotificationsList and the bell share one unread count', () => {
  it('empties the badge on mark-all-read, including the rows this page never loaded', async () => {
    unread = 5;
    // Two rows on screen against five unread on the server, and a cursor saying there is more:
    // patching the loaded rows cannot reach zero, so only a shared counter can.
    serveList({ items: [notification('n1'), notification('n2')], nextCursor: 'cursor-1' });
    renderListWithBell();
    await waitFor(() => expect(bell().textContent).toContain('5'));

    const markAll = await screen.findByRole('button', {
      name: messages.app.notifications.markAllRead,
    });
    fireEvent.click(markAll);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/workspaces/w1/notifications/read-all'),
    );
    // Locally, in the same pass as the rows: nothing here waits for a socket signal or a refetch.
    await waitFor(() => expect(bell().textContent).toBe(''));
  });

  /** A badge cleared by a write the server refused is a lie with nowhere to correct itself. */
  it('keeps the badge when the page could not mark everything read', async () => {
    unread = 5;
    serveList({ items: [notification('n1')], nextCursor: null });
    apiPost.mockRejectedValue(new Error('network'));
    renderListWithBell();
    await waitFor(() => expect(bell().textContent).toContain('5'));

    fireEvent.click(
      await screen.findByRole('button', { name: messages.app.notifications.markAllRead }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messages.app.notifications.markReadError),
    );
    expect(bell().textContent).toContain('5');
  });
});
