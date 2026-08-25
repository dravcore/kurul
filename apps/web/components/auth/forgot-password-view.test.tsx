import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  requestPasswordReset:
    vi.fn<
      (args: {
        email: string;
        redirectTo: string;
      }) => Promise<{ error: { code?: string; status?: number } | null }>
    >(),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { requestPasswordReset: mocks.requestPasswordReset },
}));

import { ForgotPasswordView } from './forgot-password-view';

const NEUTRAL_MESSAGE =
  'If that address has an account, a reset link is on its way. It works for one hour.';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ForgotPasswordView />
    </NextIntlClientProvider>,
  );
}

function submit(email: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

beforeEach(() => {
  mocks.requestPasswordReset.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('ForgotPasswordView', () => {
  it('asks the API for a link that lands on the reset page, and confirms without naming the account', async () => {
    renderView();

    submit('  ayse@example.com ');

    await waitFor(() =>
      expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
        email: 'ayse@example.com',
        redirectTo: '/reset-password',
      }),
    );
    // The API answers the same way for every address, so the page has to as well: anything
    // more specific would confirm which addresses exist to whoever types them in.
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status.textContent).toBe(NEUTRAL_MESSAGE));
  });

  it('says the same neutral thing whether or not the API found an account', async () => {
    // A refused request is the only thing that changes the wording; a 200 for an unknown
    // address (the API's behaviour) reads exactly like a 200 for a known one.
    renderView();

    submit('nobody@example.com');

    const status = await screen.findByRole('status');
    await waitFor(() => expect(status.textContent).toBe(NEUTRAL_MESSAGE));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the form and announces the failure when the request is refused', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ error: { code: 'RATE_LIMITED' } });
    renderView();

    submit('ayse@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not send the link. Try again in a moment.');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy();
  });

  it('takes the confirmation back down when a later send is refused', async () => {
    // Three sends a minute is all the endpoint allows, so someone whose mail has not arrived
    // yet is very likely to submit again and be refused. The success notice has to go with the
    // send it described, or the page claims a link is on its way and that it could not be sent.
    renderView();
    submit('ayse@example.com');
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status.textContent).toBe(NEUTRAL_MESSAGE));

    mocks.requestPasswordReset.mockResolvedValue({ error: { status: 500 } });
    submit('ayse@example.com');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('names the rate limit rather than blaming the send', async () => {
    // Better Auth's limiter answers `429` with no error code of its own, so the status is what
    // there is to branch on (docs/design.md §6 asks for its own copy here).
    mocks.requestPasswordReset.mockResolvedValue({ error: { status: 429 } });
    renderView();

    submit('ayse@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Too many requests. Try again in a few seconds.');
  });

  it('treats a thrown request like a refused one', async () => {
    mocks.requestPasswordReset.mockRejectedValue(new Error('network'));
    renderView();

    submit('ayse@example.com');

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('offers the way back to sign in', () => {
    renderView();

    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/login',
    );
  });
});
