import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const ACCEPT_LABEL = messages.auth.invite.submit;

const INVITATION_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

interface SessionUser {
  email: string;
  emailVerified: boolean;
}

interface AuthClientError {
  code?: string;
  message?: string;
  status: number;
  statusText: string;
}

interface InvitationResult {
  data: { organizationId: string; organizationName: string } | null;
  error: AuthClientError | null;
}

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  session: { data: null, isPending: false } as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  },
  replace: vi.fn(),
  refresh: vi.fn(),
  getInvitation: vi.fn<(args: { query: { id: string } }) => Promise<InvitationResult>>(),
  setActive: vi.fn(),
  sendVerificationEmail: vi.fn(),
  post: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => mocks.session,
    sendVerificationEmail: mocks.sendVerificationEmail,
    organization: { getInvitation: mocks.getInvitation, setActive: mocks.setActive },
  },
}));

// Only the transport is faked: `ApiError`, `apiStatus` and `resolveApiMessage` stay real, so
// these tests exercise the same status-to-copy mapping the app runs.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: mocks.post } };
});

import { ApiError } from '@/lib/api';
import { InviteAcceptView } from './invite-accept-view';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InviteAcceptView invitationId={INVITATION_ID} />
    </NextIntlClientProvider>,
  );
}

function signedIn(emailVerified: boolean): void {
  mocks.session = {
    data: { user: { email: 'ayse@example.com', emailVerified } },
    isPending: false,
  };
}

function forbidden(code: string): AuthClientError {
  return { code, message: 'Forbidden', status: 403, statusText: 'Forbidden' };
}

function invitationLoads(): void {
  mocks.getInvitation.mockResolvedValue({
    data: { organizationId: WORKSPACE_ID, organizationName: 'Steppe Collective' },
    error: null,
  });
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.session = { data: null, isPending: false };
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.setActive.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.sendVerificationEmail
    .mockReset()
    .mockResolvedValue({ data: { status: true }, error: null });
  mocks.getInvitation.mockReset();
  mocks.post.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe('InviteAcceptView', () => {
  it('sends a signed-out visitor to sign in and back again', () => {
    renderView();

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      `/login?next=/invite/${INVITATION_ID}`,
    );
    expect(mocks.getInvitation).not.toHaveBeenCalled();
  });

  it('names the workspace and accepts the invitation', async () => {
    signedIn(true);
    invitationLoads();
    renderView();

    expect(await screen.findByText("You've been invited to join Steppe Collective.")).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ACCEPT_LABEL }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `/workspaces/${WORKSPACE_ID}/invitations/${INVITATION_ID}/accept`,
      ),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: WORKSPACE_ID });
  });

  it('explains the block instead of hiding it when the invitation cannot even be read', async () => {
    // The regression this screen was rebuilt for: an unconfirmed invitee used to be refused by
    // `get-invitation` and never reached the accept button at all.
    signedIn(false);
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: forbidden('EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION'),
    });
    renderView();

    expect(await screen.findByRole('heading', { name: 'Confirm your email first' })).toBeTruthy();
    expect(screen.getByText(/Send a link to ayse@example\.com/)).toBeTruthy();
  });

  it('brings the invitee back to this invitation after they confirm', async () => {
    signedIn(false);
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: forbidden('EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION'),
    });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));

    // The callback path is what stops a confirmed invitee from having to hunt down the
    // original invitation email again.
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'ayse@example.com',
      callbackURL: `/invite/${INVITATION_ID}`,
    });
  });

  it('surfaces a confirmation link that failed on its way back here', async () => {
    mocks.searchParams = new URLSearchParams('error=TOKEN_EXPIRED');
    signedIn(false);
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: forbidden('EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION'),
    });
    renderView();

    expect(await screen.findByRole('heading', { name: 'Confirm your email first' })).toBeTruthy();
    expect(screen.getByText(/This link has expired/)).toBeTruthy();
  });

  it('does not offer confirmation to someone who is simply not the invitee', async () => {
    // Same 403, same unconfirmed session — only Better Auth's code separates the two, and
    // telling this user to confirm their address would send them round a pointless loop.
    signedIn(false);
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: forbidden('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION'),
    });
    renderView();

    expect(
      await screen.findByText('This invitation is no longer available. Ask for a new one.'),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Confirm your email first' })).toBeNull();
  });

  it('turns a refused accept into the confirm-first screen and takes focus with it', async () => {
    // Our own accept endpoint sends no machine-readable code, so this path is decided by the
    // 403 plus what the session says about the account.
    signedIn(false);
    invitationLoads();
    mocks.post.mockRejectedValue(
      new ApiError({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Confirm your email address before accepting this invitation',
      }),
    );
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: ACCEPT_LABEL }));

    const heading = await screen.findByRole('heading', { name: 'Confirm your email first' });
    // The button that was pressed is gone; focus has to land somewhere deliberate.
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('reports a refused accept as a wrong address when the account is confirmed', async () => {
    signedIn(true);
    invitationLoads();
    mocks.post.mockRejectedValue(
      new ApiError({ statusCode: 403, error: 'Forbidden', message: 'nope' }),
    );
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: ACCEPT_LABEL }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'This invitation was sent to a different address.',
      ),
    );
    expect(screen.queryByRole('heading', { name: 'Confirm your email first' })).toBeNull();
  });

  it('reads the invitation once the address is confirmed', async () => {
    // What a returning invitee lands on: the session now carries `emailVerified`, so the same
    // request that was refused a moment ago succeeds and the accept button is reachable.
    signedIn(true);
    invitationLoads();
    renderView();

    expect(await screen.findByRole('button', { name: ACCEPT_LABEL })).toBeTruthy();
    expect(mocks.getInvitation).toHaveBeenCalledWith({ query: { id: INVITATION_ID } });
  });
});
