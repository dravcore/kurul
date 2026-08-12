import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { LanguageSettings } from './language-settings';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const writeLocaleCookie = vi.fn();
vi.mock('@/lib/locale-cookie', () => ({
  writeLocaleCookie: (...args: unknown[]) => writeLocaleCookie(...args),
}));

const apiGet = vi.mocked(api.get);
const apiPatch = vi.mocked(api.patch);

function user(locale: string | null) {
  return {
    id: 'u1',
    email: 'a@b.c',
    name: 'Ada',
    avatarUrl: null,
    locale,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderSettings() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LanguageSettings />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  refresh.mockReset();
  writeLocaleCookie.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LanguageSettings', () => {
  it('shows the stored preference as the selected option', async () => {
    apiGet.mockResolvedValue(user('en') as never);
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    expect((select as HTMLSelectElement).value).toBe('en');
  });

  it('shows "match my browser" for a user who never chose', async () => {
    // `null` is a distinct state from English — the user follows Accept-Language — so the
    // control must be able to represent it rather than defaulting to the English option.
    apiGet.mockResolvedValue(user(null) as never);
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    expect((select as HTMLSelectElement).value).toBe('');
    expect(
      screen.getByRole('option', { name: messages.app.settings.language.followBrowser }),
    ).toBeTruthy();
  });

  it('offers every supported language, named from the catalog', async () => {
    apiGet.mockResolvedValue(user(null) as never);
    renderSettings();

    expect(
      await screen.findByRole('option', { name: messages.app.settings.language.options.en }),
    ).toBeTruthy();
  });

  it('writes the choice to the database and mirrors it into the cookie', async () => {
    apiGet.mockResolvedValue(user(null) as never);
    apiPatch.mockResolvedValue(user('en') as never);
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    fireEvent.change(select, { target: { value: 'en' } });

    // Both, always: the database is what outbound email reads, the cookie is what the next
    // server render reads without waiting on `/me`.
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/me', { locale: 'en' }));
    expect(writeLocaleCookie).toHaveBeenCalledWith('en');
  });

  it('clears the preference to null when the user goes back to the browser default', async () => {
    apiGet.mockResolvedValue(user('en') as never);
    apiPatch.mockResolvedValue(user(null) as never);
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/me', { locale: null }));
    // Expiring the cookie is what actually lets Accept-Language win again.
    expect(writeLocaleCookie).toHaveBeenCalledWith(null);
  });

  it('re-renders the tree, because the catalog is chosen on the server', async () => {
    apiGet.mockResolvedValue(user(null) as never);
    apiPatch.mockResolvedValue(user('en') as never);
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    fireEvent.change(select, { target: { value: 'en' } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('leaves the cookie alone when the write fails', async () => {
    // A cookie written past a failed save would show a language the account does not have,
    // and the next device would disagree with this one.
    apiGet.mockResolvedValue(user(null) as never);
    apiPatch.mockRejectedValue(new Error('network'));
    renderSettings();

    const select = await screen.findByLabelText(messages.app.settings.language.label);
    fireEvent.change(select, { target: { value: 'en' } });

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(writeLocaleCookie).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports a failed load instead of rendering an empty picker', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    renderSettings();

    expect(await screen.findByText(messages.app.settings.language.loadError)).toBeTruthy();
  });
});
