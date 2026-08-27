import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { UserDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { AccountSettings } from './account-settings';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn() } };
});

const apiGet = vi.mocked(api.get);

function user(email: string): UserDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1dee',
    email,
    name: 'Ada',
    avatarUrl: null,
    locale: null,
    emailNotifications: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderSettings() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AccountSettings />
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

describe('AccountSettings', () => {
  it('shows the signed-in address', async () => {
    apiGet.mockResolvedValue(user('ada@example.com') as never);
    renderSettings();

    expect(await screen.findByText('ada@example.com')).toBeTruthy();
  });

  it('links the delete control out to its own route, rather than opening a dialog here', async () => {
    apiGet.mockResolvedValue(user('ada@example.com') as never);
    renderSettings();

    const link = await screen.findByRole('link', {
      name: messages.app.settings.account.deleteAction,
    });
    expect(link.getAttribute('href')).toBe('/settings/account/delete');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports a failed load instead of a broken row', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    renderSettings();

    expect(await screen.findByText(messages.app.settings.account.loadError)).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: messages.app.settings.account.deleteAction }),
    ).toBeNull();
  });
});
