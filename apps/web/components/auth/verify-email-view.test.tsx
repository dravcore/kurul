import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

interface SessionUser {
  email: string;
  emailVerified: boolean;
}

interface SendResult {
  data: { status: boolean } | null;
  error: { code?: string; message?: string; status: number; statusText: string } | null;
}

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  session: { data: null, isPending: false } as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  },
  sendVerificationEmail:
    vi.fn<(body: { email: string; callbackURL?: string }) => Promise<SendResult>>(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => mocks.session,
    sendVerificationEmail: mocks.sendVerificationEmail,
  },
}));

import { VerifyEmailView } from './verify-email-view';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VerifyEmailView />
    </NextIntlClientProvider>,
  );
}

function signedIn(emailVerified: boolean): void {
  mocks.session = {
    data: { user: { email: 'ayse@example.com', emailVerified } },
    isPending: false,
  };
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.session = { data: null, isPending: false };
  mocks.sendVerificationEmail.mockReset();
  mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
});

afterEach(() => {
  cleanup();
});

describe('VerifyEmailView', () => {
  it('treats a link with no error parameter as a confirmed address', () => {
    signedIn(true);
    renderView();

    expect(screen.getByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your workspace' }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });

  it('offers sign-in instead when the link was opened without a session', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('holds the call to action back until the session settles', () => {
    mocks.session = { data: null, isPending: true };
    renderView();

    // Either answer would be a guess while the session is unknown, and a CTA that flips under
    // the pointer is worse than one that arrives a beat late.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('explains an expired link and offers a fresh one', () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    signedIn(false);
    renderView();

    expect(screen.getByRole('heading', { name: "This link didn't work" })).toBeTruthy();
    expect(screen.getByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeTruthy();
  });

  it('explains an invalid link', () => {
    mocks.searchParams = new URLSearchParams('error=INVALID_TOKEN');
    signedIn(false);
    renderView();

    expect(screen.getByText(/isn't valid/)).toBeTruthy();
  });

  it('explains an unknown code without claiming the address was confirmed', () => {
    mocks.searchParams = new URLSearchParams('error=SOMETHING_ELSE');
    signedIn(false);
    renderView();

    expect(screen.getByRole('heading', { name: "This link didn't work" })).toBeTruthy();
    expect(screen.getByText("This link couldn't be checked.")).toBeTruthy();
  });

  it('points a link with no account at registration and asks for the address', () => {
    mocks.searchParams = new URLSearchParams('error=USER_NOT_FOUND');
    renderView();

    expect(screen.getByText("There's no account for the address in this link.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/register');
    // Signed out, nobody knows who to send the new link to.
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it("reports the address a signed-in visitor's new link was sent to", async () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    signedIn(false);
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'ayse@example.com',
      callbackURL: '/verify-email',
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        "A new link is on its way to ayse@example.com. It's good for a short while.",
      ),
    );
  });

  it('stays vague about whether a signed-out address is even registered', async () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    renderView();

    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: ' bora@example.com ' } });
    fireEvent.submit(input.closest('form')!);

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'bora@example.com',
      callbackURL: '/verify-email',
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'If that address has an unconfirmed account, a new link is on its way.',
      ),
    );
  });

  it('says so when the address turns out to be confirmed already', async () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    signedIn(false);
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { code: 'EMAIL_ALREADY_VERIFIED', status: 400, statusText: 'Bad Request' },
    });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('This address is already confirmed.'),
    );
  });

  it('reports a failed send without blaming the link', async () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    signedIn(false);
    mocks.sendVerificationEmail.mockRejectedValue(new Error('offline'));
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Could not send the link. Try again in a moment.',
      ),
    );
  });

  it('reports success when the session is already confirmed, whatever the link said', () => {
    // Two links in the mailbox, or a second tab: the older one fails, but the account is done.
    mocks.searchParams = new URLSearchParams('error=INVALID_TOKEN');
    signedIn(true);
    renderView();

    expect(screen.getByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
  });
});
