import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationType, type NotificationDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { NotificationsList } from './notifications-list';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/notification-actions', () => ({
  markAllNotificationsRead: vi.fn(),
  openNotificationTarget: vi.fn(),
}));
vi.mock('./use-notification-socket', () => ({ useNotificationSocket: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: 'w1', activeRole: null }),
}));

const apiGet = vi.mocked(api.get);

function notification(id: string): NotificationDto {
  return {
    id,
    workspaceId: 'w1',
    userId: 'u1',
    type: NotificationType.Mention,
    taskId: 't1',
    activityId: null,
    payload: {},
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderList(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationsList />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NotificationsList', () => {
  it('lists the notifications it loaded', async () => {
    apiGet.mockResolvedValue({ items: [notification('n1')], nextCursor: null } as never);
    renderList();

    expect(await screen.findByText(/mentioned/i)).toBeDefined();
  });

  it('says it is empty only when the load succeeded and returned nothing', async () => {
    apiGet.mockResolvedValue({ items: [], nextCursor: null } as never);
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
});
