import { MemberRole } from '@kurul/shared-types';
import type { MailMessage } from '../mail/mail-sender';
import { sendMail } from '../mail/send-mail';
import { readStoredLocale } from '../mail/stored-locale';
import { evictUserFromWorkspaceSockets } from '../realtime/workspace-socket-eviction';
import { organizationOptions } from './organization-options';

jest.mock('../mail/send-mail', () => ({
  sendMail: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
}));

// Mocked rather than left to fail through: the real reader opens a Prisma client, and the
// point of these cases is which address the hook *asks* about, not what a database answers.
jest.mock('../mail/stored-locale', () => ({
  readStoredLocale: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
}));

jest.mock('../realtime/workspace-socket-eviction', () => ({
  evictUserFromWorkspaceSockets: jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined),
}));

const sendMailMock = jest.mocked(sendMail);
const evictMock = jest.mocked(evictUserFromWorkspaceSockets);
const storedLocaleMock = jest.mocked(readStoredLocale);

/** The shape Better Auth hands to `sendInvitationEmail`, trimmed to what the hook reads. */
function invitationEmailData(overrides?: { id?: string; email?: string }) {
  return {
    id: overrides?.id ?? '0199f0d2-0000-7000-8000-000000000001',
    role: MemberRole.MEMBER,
    email: overrides?.email ?? 'invitee@example.test',
    organization: { name: 'Analytical Engine' },
    invitation: {},
    inviter: { user: { name: 'Ada Lovelace', email: 'inviter@example.test' } },
  };
}

/** Casts the trimmed fixture to the plugin's own payload type, as the hook receives it. */
type InvitationArgs = Parameters<typeof organizationOptions.sendInvitationEmail>;
function asInvitation(data: ReturnType<typeof invitationEmailData>): InvitationArgs[0] {
  return data as InvitationArgs[0];
}

describe('organizationOptions', () => {
  const originalWebUrl = process.env.WEB_URL;

  beforeEach(() => {
    sendMailMock.mockClear();
    evictMock.mockClear();
    storedLocaleMock.mockReset();
    storedLocaleMock.mockResolvedValue(null);
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
      await organizationOptions.sendInvitationEmail(asInvitation(invitationEmailData()), undefined);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it('mails the invited address a link to that invitation on the web app', async () => {
      await organizationOptions.sendInvitationEmail(
        asInvitation(
          invitationEmailData({
            id: '0199f0d2-0000-7000-8000-0000000000ff',
            email: 'someone@example.test',
          }),
        ),
        undefined,
      );

      const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
      expect(message.to).toBe('someone@example.test');
      expect(message.subject).toContain('Analytical Engine');
      expect(message.text).toContain(
        'https://app.example.test/invite/0199f0d2-0000-7000-8000-0000000000ff',
      );
    });

    /**
     * The locale rule, at the one call site where it is not a formality: an invited address
     * may belong to nobody yet, so "the recipient's stored preference" is frequently absent
     * and something has to be decided in its place — see `mail/recipient-locale.ts`.
     */
    describe('recipient language', () => {
      it("writes in the invitee's own language when they already have an account", async () => {
        storedLocaleMock.mockImplementation((email) =>
          Promise.resolve(email === 'invitee@example.test' ? 'tr' : 'en'),
        );

        await organizationOptions.sendInvitationEmail(
          asInvitation(invitationEmailData()),
          undefined,
        );

        const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
        expect(message.subject).toContain('davet edildiniz');
      });

      it("writes in the inviter's language when the address has no account yet", async () => {
        storedLocaleMock.mockImplementation((email) =>
          Promise.resolve(email === 'inviter@example.test' ? 'tr' : null),
        );

        await organizationOptions.sendInvitationEmail(
          asInvitation(invitationEmailData()),
          undefined,
        );

        const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
        expect(message.subject).toContain('davet edildiniz');
      });

      it("falls back to the inviter's Accept-Language when nobody stored a preference", async () => {
        const request = new Request('https://api.example.test/organization/invite-member', {
          headers: { 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' },
        });

        await organizationOptions.sendInvitationEmail(asInvitation(invitationEmailData()), request);

        const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
        expect(message.subject).toContain('davet edildiniz');
      });

      it('sends English when nothing at all is known about either party', async () => {
        await organizationOptions.sendInvitationEmail(
          asInvitation(invitationEmailData()),
          undefined,
        );

        const message = sendMailMock.mock.calls[0]?.[0] as MailMessage;
        expect(message.subject).toContain('You have been invited');
      });
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
