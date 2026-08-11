import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

interface SessionUser {
  email: string;
  emailVerified: boolean;
}

const mocks = vi.hoisted(() => ({
  session: { data: null, isPending: false } as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  },
}));

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => mocks.session,
    sendVerificationEmail: vi.fn(),
  },
}));

import { EmailVerificationLink } from './email-verification-link';

function renderLink(collapsed = false): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EmailVerificationLink collapsed={collapsed} />
    </NextIntlClientProvider>,
  );
}

function signedIn(emailVerified: boolean, isPending = false): void {
  mocks.session = { data: { user: { email: 'ayse@example.com', emailVerified } }, isPending };
}

beforeEach(() => {
  mocks.session = { data: null, isPending: false };
});

afterEach(() => {
  cleanup();
});

describe('EmailVerificationLink', () => {
  it('offers a way to confirm an unconfirmed address', () => {
    signedIn(false);
    renderLink();

    const link = screen.getByRole('link', { name: 'Confirm your email' });
    // The flag is what separates "I came to ask for a link" from "I just followed one".
    expect(link.getAttribute('href')).toBe('/verify-email?resend=1');
  });

  it('stays out of the way once the address is confirmed', () => {
    signedIn(true);
    renderLink();

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows nothing while the session is still unknown', () => {
    mocks.session = { data: null, isPending: true };
    renderLink();

    // Rendering on a hunch and retracting it a beat later is worse than arriving late.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows nothing when nobody is signed in', () => {
    renderLink();

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps its name in the collapsed rail, where the icon is the whole control', () => {
    signedIn(false);
    renderLink(true);

    const link = screen.getByRole('link', { name: 'Confirm your email' });
    expect(link.textContent).toBe('');
    expect(link.getAttribute('href')).toBe('/verify-email?resend=1');
  });

  it('leaves the naming to its visible text when the sidebar is expanded', () => {
    signedIn(false);
    renderLink();

    const link = screen.getByRole('link', { name: 'Confirm your email' });
    expect(link.textContent).toBe('Confirm your email');
    expect(link.getAttribute('aria-label')).toBeNull();
  });
});
