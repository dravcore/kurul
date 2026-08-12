import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import messages from '@/messages/en.json';

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/layout/topbar', () => ({
  Topbar: ({ title }: Readonly<{ title: string }>): React.ReactElement => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

vi.mock('@/components/notification/notifications-list', () => ({
  NotificationsList: (): React.ReactElement => <div data-testid="notifications-list" />,
}));

import NotificationsPage from './page';

afterEach(() => {
  cleanup();
});

describe('NotificationsPage', () => {
  it('uses the page title, not the bell popover title', async () => {
    render(await NotificationsPage());

    // `app.notifications` carries both `title` and `pageTitle`; the route must take the latter.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      messages.app.notifications.pageTitle,
    );
  });

  it('renders the notifications list', async () => {
    render(await NotificationsPage());

    expect(screen.getByTestId('notifications-list')).toBeTruthy();
  });
});
