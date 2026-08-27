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

vi.mock('@/components/settings/delete-account-settings', () => ({
  DeleteAccountSettings: (): React.ReactElement => <div data-testid="delete-account-settings" />,
}));

import DeleteAccountPage from './page';

afterEach(() => {
  cleanup();
});

describe('DeleteAccountPage', () => {
  it('uses the delete page title, not the settings-screen section title', async () => {
    render(await DeleteAccountPage());

    // `app.settings.account` carries both `title` (the `/settings` section heading) and
    // `deletePageTitle`; the route must take the latter, same as `MembersSettingsPage`.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      messages.app.settings.account.deletePageTitle,
    );
  });

  it('mounts the delete-account settings surface', async () => {
    render(await DeleteAccountPage());

    expect(screen.getByTestId('delete-account-settings')).toBeTruthy();
  });
});
