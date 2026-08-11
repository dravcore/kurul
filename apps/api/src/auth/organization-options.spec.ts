import { MemberRole } from '@kurultay/shared-types';
import type { MailMessage } from '../mail/mail-sender';
import { sendMail } from '../mail/send-mail';
import { organizationOptions } from './organization-options';

jest.mock('../mail/send-mail', () => ({
  sendMail: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
}));

const sendMailMock = jest.mocked(sendMail);

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

  it('keeps the workspace schema mapping', () => {
    expect(organizationOptions.schema.organization.modelName).toBe('workspace');
    expect(organizationOptions.schema.member.fields.organizationId).toBe('workspaceId');
    expect(organizationOptions.schema.invitation.fields.organizationId).toBe('workspaceId');
  });
});
