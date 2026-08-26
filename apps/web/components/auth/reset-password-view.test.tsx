import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  resetPassword:
    vi.fn<
      (args: {
        newPassword: string;
        token: string;
      }) => Promise<{ error: { code?: string; status?: number } | null }>
    >(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/lib/auth', () => ({
  authClient: { resetPassword: mocks.resetPassword },
}));

import { ResetPasswordView } from './reset-password-view';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResetPasswordView />
    </NextIntlClientProvider>,
  );
}

function submit(password: string): void {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

function expectUnusableLink(): void {
  expect(screen.getByRole('heading', { name: "This link didn't work" })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Send a new link' }).getAttribute('href')).toBe(
    '/forgot-password',
  );
  expect(screen.queryByLabelText('New password')).toBeNull();
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams('token=opaque-token');
  mocks.resetPassword.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('ResetPasswordView', () => {
  it('sets the new password with the token off the URL and offers sign-in afterwards', async () => {
    renderView();

    submit('correct-horse-battery');

    await waitFor(() =>
      expect(mocks.resetPassword).toHaveBeenCalledWith({
        newPassword: 'correct-horse-battery',
        token: 'opaque-token',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    // No session was minted by the reset, so the next move is to sign in, not the dashboard.
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('enforces the eight-character password rule in the field itself', () => {
    renderView();

    expect(screen.getByLabelText('New password').getAttribute('minlength')).toBe('8');
  });

  it('sends someone who arrived without a token to ask for a link', () => {
    mocks.searchParams = new URLSearchParams();
    renderView();

    expectUnusableLink();
  });

  it('reads the failure the API redirected back with', () => {
    // The API checks the token before redirecting here and reports a bad one as `?error=`.
    mocks.searchParams = new URLSearchParams('error=INVALID_TOKEN');
    renderView();

    expectUnusableLink();
  });

  it('switches to the unusable-link screen when the token dies between load and submit', async () => {
    mocks.resetPassword.mockResolvedValue({ error: { code: 'INVALID_TOKEN' } });
    renderView();

    submit('correct-horse-battery');

    await waitFor(() => expectUnusableLink());
  });

  it('puts a password-rule refusal under the field', async () => {
    mocks.resetPassword.mockResolvedValue({ error: { code: 'PASSWORD_TOO_SHORT' } });
    renderView();

    submit('short');

    expect(await screen.findByText('Password must be at least 8 characters long.')).toBeTruthy();
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the rate limit rather than sending the reader after another link', async () => {
    // Better Auth's limiter answers `429` with no error code of its own. The generic message
    // tells the reader to request a new link, which is exactly what a counting limiter refuses.
    mocks.resetPassword.mockResolvedValue({ error: { status: 429 } });
    renderView();

    submit('correct-horse-battery');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Too many requests. Try again in a few seconds.');
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });

  it('announces any other refusal above the form and keeps the form', async () => {
    mocks.resetPassword.mockResolvedValue({ error: { code: 'SOMETHING_ELSE' } });
    renderView();

    submit('correct-horse-battery');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Could not change your password. Send yourself a new link and try again.',
    );
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });
});
