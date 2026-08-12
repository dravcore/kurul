import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signUpEmail:
    vi.fn<
      (args: { name: string; email: string; password: string }) => Promise<{ error: unknown }>
    >(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { signUp: { email: mocks.signUpEmail } },
}));

import RegisterPage from './page';

function renderPage(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RegisterPage />
    </NextIntlClientProvider>,
  );
}

function fillForm(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ayşe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ayse@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signUpEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('RegisterPage', () => {
  it('sends a new account to workspace creation, not to an empty dashboard', async () => {
    renderPage();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

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
    renderPage();

    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('8');
  });

  it('reports a refused sign-up without navigating away', async () => {
    mocks.signUpEmail.mockResolvedValue({ error: { message: 'Email already taken' } });
    renderPage();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(messages.auth.register.error)).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
