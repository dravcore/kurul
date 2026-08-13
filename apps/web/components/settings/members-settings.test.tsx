import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type InvitationDto, type WorkspaceMemberDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const loadMembers = vi.mocked(fetchAllWorkspaceMembers);
const loadInvitations = vi.mocked(fetchPendingInvitations);
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

describe('MembersSettings — an ADMIN facing an OWNER', () => {
  it('draws no menu on an OWNER row, because the API would only ever refuse it', async () => {
    workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.ADMIN };
    renderSection();

    expect(await screen.findByText('Ceren')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actions for Ceren' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Bora' })).toBeTruthy();
  });
});
