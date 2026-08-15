import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import {
  MailDeliveryStatus,
  MemberRole,
  type InvitationDto,
  type WorkspaceMemberDto,
} from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { SMTP_SETUP_DOCS_URL, fetchInstanceConfig } from '@/lib/instance-config';
import { fetchAllWorkspaceMembers, fetchPendingInvitations } from '@/lib/member-query';
import { MembersSettings } from './members-settings';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const ME_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const BORA_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const CEREN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

const copy = messages.app.settings.members;

const workspace = vi.hoisted(() => ({
  value: { activeId: '', activeRole: null as MemberRole | null },
}));

vi.mock('@/lib/member-query', () => ({
  fetchAllWorkspaceMembers: vi.fn(),
  fetchPendingInvitations: vi.fn(),
}));
// Only the fetch is replaced; `SMTP_SETUP_DOCS_URL` stays real so the assertion on the
// notice's link checks the address the app actually ships.
vi.mock('@/lib/instance-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance-config')>()),
  fetchInstanceConfig: vi.fn(),
}));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: ME_ID } } }),
    organization: { setActive: vi.fn() },
  },
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const loadMembers = vi.mocked(fetchAllWorkspaceMembers);
const loadInvitations = vi.mocked(fetchPendingInvitations);
const loadConfig = vi.mocked(fetchInstanceConfig);
const apiPost = vi.mocked(api.post);
const apiPatch = vi.mocked(api.patch);
const apiDelete = vi.mocked(api.delete);

function member(userId: string, name: string, role: MemberRole): WorkspaceMemberDto {
  return {
    id: `membership-${userId}`,
    workspaceId: WORKSPACE_ID,
    userId,
    role,
    name,
    avatarUrl: null,
  };
}

function invitation(
  id: string,
  email: string,
  role: MemberRole = MemberRole.MEMBER,
): InvitationDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    email,
    role,
    status: 'pending',
    expiresAt: '2099-01-01T00:00:00.000Z',
    acceptUrl: `https://kurultay.test/invite/${id}`,
  };
}

const ROSTER = [
  member(ME_ID, 'Ayla', MemberRole.OWNER),
  member(BORA_ID, 'Bora', MemberRole.MEMBER),
  member(CEREN_ID, 'Ceren', MemberRole.OWNER),
];

function apiFailure(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Conflict', message: 'server wording, never shown' });
}

function renderSection(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MembersSettings />
    </NextIntlClientProvider>,
  );
}

/** Radix opens its menu from the keyboard, which is also the path jsdom can drive. */
async function openRowMenu(name: string): Promise<void> {
  const trigger = await screen.findByRole('button', { name: `Actions for ${name}` });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function clickMenuItem(label: string): void {
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

/** Opens the invite dialog, types an address, and submits it at the default role. */
async function sendInvitation(email: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: copy.inviteAction }));
  fireEvent.change(screen.getByLabelText(copy.inviteEmail), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: copy.inviteSubmit }));
}

/** The last match, because a row control and the dialog it opens share the same verb. */
function clickLastButton(label: string): void {
  const buttons = screen.getAllByRole('button', { name: label });
  fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
}

beforeAll(() => {
  // Radix Dialog and Popper both measure their content; jsdom ships neither.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.OWNER };
  loadMembers.mockReset().mockResolvedValue(ROSTER);
  loadInvitations.mockReset().mockResolvedValue([]);
  // The configured deployment is the default, so the warning cases have to say so explicitly.
  loadConfig.mockReset().mockResolvedValue({ mailEnabled: true, attachmentsEnabled: false });
  apiPost.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MembersSettings — inviting', () => {
  it('sends the address and role the admin chose to the invitations endpoint', async () => {
    const created = invitation('inv-1', 'yeni@kurultay.test', MemberRole.ADMIN);
    apiPost.mockResolvedValue(created as never);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.inviteAction }));
    fireEvent.change(screen.getByLabelText(copy.inviteEmail), {
      target: { value: '  yeni@kurultay.test  ' },
    });
    fireEvent.change(screen.getByLabelText(copy.inviteRole), {
      target: { value: MemberRole.ADMIN },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.inviteSubmit }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/invitations`, {
      email: 'yeni@kurultay.test',
      role: MemberRole.ADMIN,
    });
    // The point of the flow: the invitation an admin just sent is now something they can see.
    expect(await screen.findByText('yeni@kurultay.test')).toBeTruthy();
  });

  /**
   * The third beat of the invite flow reports something the screen cannot show — what happened
   * in someone else's inbox (docs/design.md §7). Before `emailDelivery` existed it always said
   * "sent", including on a deployment where the message went to a log file (audit PM-04).
   */
  it('confirms the invitation as sent when the server delivered it', async () => {
    apiPost.mockResolvedValue({
      ...invitation('inv-1', 'yeni@kurultay.test'),
      emailDelivery: MailDeliveryStatus.SENT,
    } as never);
    renderSection();

    await sendInvitation('yeni@kurultay.test');

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('downgrades the confirmation when no email went out, and names the way out', async () => {
    apiPost.mockResolvedValue({
      ...invitation('inv-1', 'yeni@kurultay.test'),
      emailDelivery: MailDeliveryStatus.NOT_CONFIGURED,
    } as never);
    renderSection();

    await sendInvitation('yeni@kurultay.test');

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toContain('yeni@kurultay.test');
    // The exit route is the Copy link control on the row this invitation just joined.
    expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toContain(copy.copyLink);
  });

  it('warns on a refused relay too, not only on a missing one', async () => {
    apiPost.mockResolvedValue({
      ...invitation('inv-1', 'yeni@kurultay.test'),
      emailDelivery: MailDeliveryStatus.FAILED,
    } as never);
    renderSection();

    await sendInvitation('yeni@kurultay.test');

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
  });

  /**
   * An absent field means the API observed no send — not that delivery failed. Warning on it
   * would cry wolf on every deployment whose invitation flow works perfectly.
   */
  it('confirms normally when the server reported no delivery status at all', async () => {
    apiPost.mockResolvedValue(invitation('inv-1', 'yeni@kurultay.test') as never);
    renderSection();

    await sendInvitation('yeni@kurultay.test');

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('never offers OWNER as an invitable role', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.inviteAction }));
    const options = Array.from(
      screen.getByLabelText(copy.inviteRole).querySelectorAll('option'),
    ).map((option) => option.textContent);

    expect(options).toEqual([copy.roles.ADMIN, copy.roles.MEMBER, copy.roles.GUEST]);
  });
});

describe('MembersSettings — revoking an invitation', () => {
  it('drops the row from the pending list once the server confirms', async () => {
    loadInvitations.mockResolvedValue([invitation('inv-1', 'bekleyen@kurultay.test')]);
    apiDelete.mockResolvedValue(undefined as never);
    renderSection();

    expect(await screen.findByText('bekleyen@kurultay.test')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: copy.revokeAction }));
    clickLastButton(copy.revokeAction);

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(apiDelete).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/invitations/inv-1`);
    await waitFor(() => expect(screen.queryByText('bekleyen@kurultay.test')).toBeNull());
  });
});

describe('MembersSettings — changing a role', () => {
  it('patches the role sub-resource and shows the new role on the row', async () => {
    apiPatch.mockResolvedValue(member(BORA_ID, 'Bora', MemberRole.ADMIN) as never);
    renderSection();

    await openRowMenu('Bora');
    clickMenuItem(copy.changeRoleAction);
    fireEvent.change(screen.getByLabelText(copy.inviteRole), {
      target: { value: MemberRole.ADMIN },
    });
    clickLastButton(copy.changeRoleSubmit);

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/members/${BORA_ID}/role`, {
      role: MemberRole.ADMIN,
    });
    await waitFor(() => expect(screen.getAllByText(copy.roles.ADMIN).length).toBeGreaterThan(0));
  });

  /**
   * The workspace has to keep an owner, and the API says so with a `409`. Per design.md §7 an
   * explained failure carries its own way out — so the user must read "make someone else an
   * owner first", never the server's own wording and never a generic "could not save".
   */
  it('turns the last-OWNER 409 into the move that would make it work', async () => {
    apiPatch.mockRejectedValue(apiFailure(409));
    renderSection();

    await openRowMenu('Ceren');
    clickMenuItem(copy.changeRoleAction);
    fireEvent.change(screen.getByLabelText(copy.inviteRole), {
      target: { value: MemberRole.MEMBER },
    });
    clickLastButton(copy.changeRoleSubmit);

    expect(await screen.findByText(copy.changeRoleErrorLastOwner)).toBeTruthy();
    expect(screen.queryByText(copy.changeRoleError)).toBeNull();
    expect(screen.queryByText('server wording, never shown')).toBeNull();
  });
});

describe('MembersSettings — removing a member', () => {
  it('asks first, names the person, and only then calls the endpoint', async () => {
    apiDelete.mockResolvedValue(undefined as never);
    renderSection();

    await openRowMenu('Bora');
    clickMenuItem(copy.removeAction);

    // Nothing has been sent yet — the dialog is the whole point of a destructive action.
    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Remove Bora?')).toBeTruthy();

    clickLastButton(copy.removeAction);

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    // Addressed by `userId`, not by the membership row id the roster happens to carry.
    expect(apiDelete).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/members/${BORA_ID}`);
    await waitFor(() => expect(screen.queryByText('Bora')).toBeNull());
  });
});

describe('MembersSettings — what a MEMBER sees', () => {
  it('draws no management control, and does not ask for the invitation queue at all', async () => {
    workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.MEMBER };
    renderSection();

    // The roster itself stays readable — that is what `@WorkspaceScoped` allows.
    expect(await screen.findByText('Bora')).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.inviteAction })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Bora' })).toBeNull();
    // The endpoint answers 403 below ADMIN; asking would report a permission as a load failure.
    expect(loadInvitations).not.toHaveBeenCalled();
  });

  it('still lets the signed-in user walk out on their own row', async () => {
    workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.MEMBER };
    loadMembers.mockResolvedValue([
      member(ME_ID, 'Ayla', MemberRole.MEMBER),
      member(BORA_ID, 'Bora', MemberRole.MEMBER),
    ]);
    renderSection();

    await openRowMenu('Ayla');

    // Leaving is self-service at every role (`@WorkspaceScoped` on `members/me/leave`).
    expect(screen.getByRole('menuitem', { name: copy.leaveAction })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: copy.removeAction })).toBeNull();
  });
});

/**
 * Audit PM-04. Without SMTP no invitation email is delivered, so nobody can confirm their
 * address, so no invitation can be accepted — a deliberate security trade-off
 * (`docs/decisions/0013-invitation-email-verification.md`) that the product used to keep
 * entirely to itself.
 */
describe('MembersSettings — a deployment that cannot send email', () => {
  it('says so, permanently, above the invite control', async () => {
    loadConfig.mockResolvedValue({ mailEnabled: false, attachmentsEnabled: false });
    renderSection();

    expect(await screen.findByText(copy.mailDisabledTitle)).toBeTruthy();
    expect(screen.getByText(copy.mailDisabledBody)).toBeTruthy();
  });

  it('carries a link to the setup docs', async () => {
    loadConfig.mockResolvedValue({ mailEnabled: false, attachmentsEnabled: false });
    renderSection();

    const link = await screen.findByRole('link', { name: copy.mailDisabledDocs });

    expect(link.getAttribute('href')).toBe(SMTP_SETUP_DOCS_URL);
  });

  /**
   * The way out has to be one the admin can take on this deployment as it stands: copying the
   * accept link out of the pending row. The notice names that control, and the control is
   * really there (docs/design.md §7).
   */
  it('points at the copy-link way out, and the control it names exists', async () => {
    loadConfig.mockResolvedValue({ mailEnabled: false, attachmentsEnabled: false });
    loadInvitations.mockResolvedValue([invitation('inv-1', 'bekleyen@kurultay.test')]);
    renderSection();

    expect(await screen.findByText(copy.mailDisabledBody)).toBeTruthy();
    expect(copy.mailDisabledBody).toContain(copy.copyLink);
    expect(screen.getByRole('button', { name: copy.copyLink })).toBeTruthy();
  });

  it('cannot be dismissed, because nothing the admin does here would make it untrue', async () => {
    loadConfig.mockResolvedValue({ mailEnabled: false, attachmentsEnabled: false });
    renderSection();

    const notice = (await screen.findByText(copy.mailDisabledTitle)).closest('div')?.parentElement;

    expect(notice?.querySelector('button')).toBeNull();
  });

  it('stays away when the deployment can send email', async () => {
    renderSection();

    expect(await screen.findByRole('button', { name: copy.inviteAction })).toBeTruthy();
    expect(screen.queryByText(copy.mailDisabledTitle)).toBeNull();
  });

  /**
   * A member cannot invite anyone, so an instance-wide warning about invitation email would
   * only be noise on a screen with no invite control — and `GET /config` is not asked for.
   */
  it('is neither shown to nor fetched for someone who cannot invite', async () => {
    workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.MEMBER };
    loadConfig.mockResolvedValue({ mailEnabled: false, attachmentsEnabled: false });
    renderSection();

    expect(await screen.findByText('Bora')).toBeTruthy();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(screen.queryByText(copy.mailDisabledTitle)).toBeNull();
  });
});

describe('MembersSettings — an ADMIN facing an OWNER', () => {
  it('draws no menu on an OWNER row, because the API would only ever refuse it', async () => {
    workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.ADMIN };
    renderSection();

    expect(await screen.findByText('Ceren')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actions for Ceren' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Bora' })).toBeTruthy();
  });
});
