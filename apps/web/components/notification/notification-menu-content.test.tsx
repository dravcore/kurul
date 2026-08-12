import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationType, type NotificationDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { NotificationMenuContent } from './notification-menu-content';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function notification(id: string, readAt: string | null): NotificationDto {
  return {
    id,
    workspaceId: 'w1',
    userId: 'u1',
    type: NotificationType.Mention,
    taskId: 't1',
    activityId: null,
    payload: {},
    readAt,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

type Props = React.ComponentProps<typeof NotificationMenuContent>;

function renderMenu(overrides: Partial<Props> = {}) {
  const props: Props = {
    items: [],
    loading: false,
    error: null,
    unreadCount: 0,
    onMarkAllRead: vi.fn(),
    onOpenNotification: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DropdownMenu open>
        <NotificationMenuContent {...props} />
      </DropdownMenu>
    </NextIntlClientProvider>,
  );
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NotificationMenuContent', () => {
  it('shows the rows it is given', () => {
    renderMenu({ items: [notification('n1', null)], unreadCount: 1 });

    expect(screen.getByRole('menuitem', { name: /mentioned/i })).toBeDefined();
  });

  /**
   * The failure case the split must not lose: an empty list under a failed load reads as
   * "you're caught up", which is the one thing it must never say wrongly.
   */
  it('reports a failed load instead of claiming there is nothing', () => {
    renderMenu({ error: messages.app.notifications.loadError });

    expect(screen.getByText(messages.app.notifications.loadError)).toBeDefined();
    expect(screen.queryByText(messages.app.notifications.empty)).toBeNull();
  });

  it('says it is loading before it says it is empty', () => {
    renderMenu({ loading: true });

    expect(screen.getByText(messages.app.notifications.loading)).toBeDefined();
    expect(screen.queryByText(messages.app.notifications.empty)).toBeNull();
  });

  it('only offers mark-all-read when something is unread', () => {
    renderMenu({ unreadCount: 0 });
    expect(
      screen.getByRole('button', { name: messages.app.notifications.markAllRead }),
    ).toHaveProperty('disabled', true);

    cleanup();
    renderMenu({ unreadCount: 3 });
    expect(
      screen.getByRole('button', { name: messages.app.notifications.markAllRead }),
    ).toHaveProperty('disabled', false);
  });

  it('closes before navigating to the full page', () => {
    const props = renderMenu();

    screen.getByRole('button', { name: messages.app.notifications.viewAll }).click();

    expect(props.onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/notifications');
  });
});
