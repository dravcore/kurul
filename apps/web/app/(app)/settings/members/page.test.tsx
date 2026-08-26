import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/layout/topbar', () => ({
  Topbar: ({ title }: Readonly<{ title: string }>): React.ReactElement => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

vi.mock('@/components/settings/members-settings', () => ({
  MembersSettings: (): React.ReactElement => <div data-testid="members-settings" />,
}));

import MembersSettingsPage from './page';

afterEach(() => {
  cleanup();
});

describe('MembersSettingsPage', () => {
  it('uses the page title, not the settings-screen section title', async () => {
    render(await MembersSettingsPage());

    // `app.settings.members` carries both `title` (the `/settings` section heading) and
    // `pageTitle`; the route must take the latter, same as `NotificationsPage`.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      messages.app.settings.members.pageTitle,
    );
  });

  it('mounts the roster', async () => {
    render(await MembersSettingsPage());

    expect(screen.getByTestId('members-settings')).toBeTruthy();
  });
});
