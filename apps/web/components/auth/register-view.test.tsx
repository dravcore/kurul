import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  refresh: vi.fn(),
  signUpEmail:
    vi.fn<
      (args: { name: string; email: string; password: string }) => Promise<{ error: unknown }>
    >(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { signUp: { email: mocks.signUpEmail } },
}));

import { RegisterView } from './register-view';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RegisterView />
    </NextIntlClientProvider>,
  );
}

function fillForm(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ayşe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ayse@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signUpEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('RegisterView', () => {
  it('sends a new account to workspace creation, not to an empty dashboard', async () => {
    renderView();
    fillForm();

    submit();

    await waitFor(() =>
      expect(mocks.signUpEmail).toHaveBeenCalledWith({
        name: 'Ayşe',
        email: 'ayse@example.com',
        password: 'correct-horse',
      }),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/workspaces/new'));
  });

  it('enforces the eight-character password rule in the field itself', () => {
    renderView();

    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('8');
  });

  it('reports a refused sign-up without navigating away', async () => {
    mocks.signUpEmail.mockResolvedValue({ error: { message: 'Email already taken' } });
    renderView();
    fillForm();

    submit();

    expect(await screen.findByText(messages.auth.register.error)).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('sends an invitee back to the invitation instead of asking for a new workspace', async () => {
    mocks.searchParams = new URLSearchParams('next=%2Finvite%2Fabc');
    renderView();
    fillForm();

    submit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/invite/abc'));
    expect(mocks.replace).not.toHaveBeenCalledWith('/workspaces/new');
  });

  it('carries the destination back to sign-in for someone who already has an account', () => {
    mocks.searchParams = new URLSearchParams('next=%2Finvite%2Fabc');
    renderView();

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      `/login?next=${encodeURIComponent('/invite/abc')}`,
    );
  });

  it.each([
    ['an absolute URL', 'https://evil.com'],
    ['a protocol-relative URL', '//evil.com'],
  ])('ignores %s and falls back to workspace creation', async (_case, hostile) => {
    mocks.searchParams = new URLSearchParams([['next', hostile]]);
    renderView();
    fillForm();

    submit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/workspaces/new'));
    expect(mocks.replace).not.toHaveBeenCalledWith(hostile);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });
});
