import { MemberRole } from '@kurultay/shared-types';
import type { MailMessage } from '../mail/mail-sender';
import { sendMail } from '../mail/send-mail';
import { evictUserFromWorkspaceSockets } from '../realtime/workspace-socket-eviction';
import { organizationOptions } from './organization-options';

jest.mock('../mail/send-mail', () => ({
  sendMail: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
}));

jest.mock('../realtime/workspace-socket-eviction', () => ({
  evictUserFromWorkspaceSockets: jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined),
}));

const sendMailMock = jest.mocked(sendMail);
const evictMock = jest.mocked(evictUserFromWorkspaceSockets);

/** The shape Better Auth hands to `sendInvitationEmail`, trimmed to what the hook reads. */
function invitationEmailData(overrides?: { id?: string; email?: string }) {
  return {
    id: overrides?.id ?? '0199f0d2-0000-7000-8000-000000000001',
    role: MemberRole.MEMBER,
    email: overrides?.email ?? 'invitee@example.test',
    organization: { name: 'Analytical Engine' },
    invitation: {},
    inviter: { user: { name: 'Ada Lovelace' } },
  };
}

describe('organizationOptions', () => {
  const originalWebUrl = process.env.WEB_URL;

  beforeEach(() => {
    sendMailMock.mockClear();
    evictMock.mockClear();
    process.env.WEB_URL = 'https://app.example.test';
  });

  afterAll(() => {
    if (originalWebUrl === undefined) {
      delete process.env.WEB_URL;
    } else {
      process.env.WEB_URL = originalWebUrl;
    }
  });

  describe('invitation email verification (GHSA-fmh4-wcc4-5jm3)', () => {
    // The regression this file exists for. `requireEmailVerificationOnInvitation: false` is
    // taken by Better Auth verbatim and switches the gate off, which is how an attacker who
    // registered an unverified account on an invited address could accept the invitation.
    it('never opts out of the verified-email requirement', () => {
      expect(organizationOptions.requireEmailVerificationOnInvitation).not.toBe(false);
    });

    it('requires a verified email before an invitation can be acted on', () => {
      expect(organizationOptions.requireEmailVerificationOnInvitation).toBe(true);
    });

    it('states the requirement explicitly rather than leaning on inference from the id generator', () => {
      expect(organizationOptions).toHaveProperty('requireEmailVerificationOnInvitation');
    });
  });

  describe('sendInvitationEmail', () => {
    it('is wired to real delivery, not a no-op', async () => {
      await organizationOptions.sendInvitationEmail(
        invitationEmailData() as Parameters<typeof organizationOptions.sendInvitationEmail>[0],
      );

      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it('mails the invited address a link to that invitation on the web app', async () => {
      await organizationOptions.sendInvitationEmail(
        invitationEmailData({
          id: '0199f0d2-0000-7000-8000-0000000000ff',
          email: 'someone@example.test',
        }) as Parameters<typeof organizationOptions.sendInvitationEmail>[0],
      );

      const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
      expect(message.to).toBe('someone@example.test');
      expect(message.subject).toContain('Analytical Engine');
      expect(message.text).toContain(
        'https://app.example.test/invite/0199f0d2-0000-7000-8000-0000000000ff',
      );
    });
  });

  /**
   * `DELETE /workspaces/:workspaceId/members/:userId` revokes HTTP access the moment the row
   * is gone, but an open Socket.io connection keeps its rooms until someone takes them away.
   * This hook is what takes them away, and it is the whole reason the Nest endpoint removes
   * members through `auth.api.removeMember` instead of Prisma — so it is asserted rather than
   * assumed.
   */
  describe('afterRemoveMember', () => {
    it('evicts the removed user from that workspace’s socket rooms', async () => {
      await organizationOptions.organizationHooks.afterRemoveMember({
        member: { userId: 'usr_removed' },
        organization: { id: 'ws_1' },
      });

      expect(evictMock).toHaveBeenCalledTimes(1);
      expect(evictMock).toHaveBeenCalledWith('ws_1', 'usr_removed');
    });

    /**
     * Eviction runs inside the removal request, before it answers, so the socket rooms are
     * gone by the time the caller sees `204` — comfortably inside the ≤5s the roadmap asks
     * for, and not on a timer that could be delayed or dropped.
     */
    it('completes within the request rather than being scheduled', async () => {
      let settled = false;
      evictMock.mockImplementation(async () => {
        await Promise.resolve();
        settled = true;
      });

      await organizationOptions.organizationHooks.afterRemoveMember({
        member: { userId: 'usr_removed' },
        organization: { id: 'ws_1' },
      });

      expect(settled).toBe(true);
    });
  });

  it('keeps the workspace schema mapping', () => {
    expect(organizationOptions.schema.organization.modelName).toBe('workspace');
    expect(organizationOptions.schema.member.fields.organizationId).toBe('workspaceId');
    expect(organizationOptions.schema.invitation.fields.organizationId).toBe('workspaceId');
  });
});
