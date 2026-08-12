import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn<(args: { email: string; password: string }) => Promise<{ error: unknown }>>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));

import LoginPage from './page';

function renderPage(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

function fillCredentials(): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ayse@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signInEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('LoginPage', () => {
  it('offers the sign-up route to a visitor without an account', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/register');
  });

  it('signs in with the typed credentials and lands on the dashboard', async () => {
    renderPage();
    fillCredentials();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: 'ayse@example.com',
        password: 'correct-horse',
      }),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
    // Without the refresh the server components keep the signed-out render.
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('keeps the visitor on the form when the credentials are refused', async () => {
    mocks.signInEmail.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    renderPage();
    fillCredentials();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Could not sign in. Check your email and password.'),
    ).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
