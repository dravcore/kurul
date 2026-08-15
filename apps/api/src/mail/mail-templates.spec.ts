import { SUPPORTED_LOCALES, type Locale } from '@kurultay/shared-types';
import { buildInvitationEmail, buildVerificationEmail } from './mail-templates';

describe('buildVerificationEmail', () => {
  const params = {
    to: 'new-user@example.test',
    name: 'Ada Lovelace',
    verificationUrl: 'http://localhost:4000/auth/verify-email?token=jwt&callbackURL=x',
    locale: 'en' as Locale,
  };

  it('addresses the recipient and carries the verification link in both bodies', () => {
    const message = buildVerificationEmail(params);

    expect(message.to).toBe('new-user@example.test');
    expect(message.subject).toContain('Kurultay');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.verificationUrl);
    // `&` is escaped in the attribute — that is correct HTML, and mail clients decode it.
    expect(message.html).toContain(
      'href="http://localhost:4000/auth/verify-email?token=jwt&amp;callbackURL=x"',
    );
  });

  it('greets a nameless account without a dangling blank', () => {
    const message = buildVerificationEmail({ ...params, name: '   ' });

    expect(message.text.startsWith('Hi,')).toBe(true);
  });

  it('writes the whole email in Turkish for a Turkish recipient', () => {
    const message = buildVerificationEmail({ ...params, locale: 'tr' });

    expect(message.subject).toContain('doğrulayın');
    expect(message.text.startsWith('Merhaba Ada Lovelace,')).toBe(true);
    // The link survives translation — it is the only part of the email that has to.
    expect(message.text).toContain(params.verificationUrl);
    expect(message.html).toContain('E-posta adresini doğrula');
    // Nothing from the English copy leaks into the Turkish body.
    expect(message.text).not.toContain('Confirm this address');
  });

  it('greets a nameless Turkish account without a dangling blank', () => {
    const message = buildVerificationEmail({ ...params, name: '   ', locale: 'tr' });

    expect(message.text.startsWith('Merhaba,')).toBe(true);
  });
});

describe('buildInvitationEmail', () => {
  const params = {
    to: 'invitee@example.test',
    inviterName: 'Ada Lovelace',
    workspaceName: 'Analytical Engine',
    acceptUrl: 'http://localhost:3000/invite/0199f0d2-0000-7000-8000-000000000001',
    locale: 'en' as Locale,
  };

  it('names the workspace and the inviter, and links to the invitation page', () => {
    const message = buildInvitationEmail(params);

    expect(message.to).toBe('invitee@example.test');
    expect(message.subject).toContain('Analytical Engine');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.acceptUrl);
    expect(message.html).toContain(`href="${params.acceptUrl}"`);
  });

  it('tells the invitee that the address has to be confirmed first', () => {
    const message = buildInvitationEmail(params);

    expect(message.text).toContain('confirm');
  });

  it('escapes markup in the workspace name, which anyone can choose', () => {
    const message = buildInvitationEmail({
      ...params,
      workspaceName: '<img src=x onerror="alert(1)">',
    });

    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });

  it('keeps a multi-line workspace name out of the subject header', () => {
    const message = buildInvitationEmail({
      ...params,
      workspaceName: 'Engine\r\nBcc: attacker@example.test',
    });

    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it('writes the whole email in Turkish, still naming the workspace and the inviter', () => {
    const message = buildInvitationEmail({ ...params, locale: 'tr' });

    expect(message.subject).toContain('Analytical Engine');
    expect(message.subject).toContain('davet edildiniz');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.acceptUrl);
    expect(message.text).toContain('doğrulanmış');
    expect(message.text).not.toContain('invited you to join');
  });

  it('states the Turkish confirm-first note the accept endpoint enforces', () => {
    // The Turkish half of "tells the invitee that the address has to be confirmed first". The
    // note is the difference between an invitation that looks broken and one that explains
    // itself, and it has to survive translation in both languages, not only in English.
    const message = buildInvitationEmail({ ...params, locale: 'tr' });

    expect(message.text).toContain('doğrula');
  });

  it('drops the inviter cleanly in Turkish when the display name is blank', () => {
    const message = buildInvitationEmail({ ...params, inviterName: '  ', locale: 'tr' });

    expect(message.text.startsWith('Kurultay')).toBe(true);
    expect(message.text).toContain('davet edildiniz');
  });
});

describe('every supported locale', () => {
  const invitation = {
    to: 'invitee@example.test',
    inviterName: 'Ada Lovelace',
    workspaceName: 'Analytical Engine',
    acceptUrl: 'http://localhost:3000/invite/0199f0d2-0000-7000-8000-000000000001',
  };
  const verification = {
    to: 'new-user@example.test',
    name: 'Ada Lovelace',
    verificationUrl: 'http://localhost:4000/auth/verify-email?token=jwt&callbackURL=x',
  };

  describe.each(SUPPORTED_LOCALES)('locale %s', (locale) => {
    it('keeps a header-splitting workspace name out of the subject', () => {
      // The existing English case, run against every language: a subject is a header in all of
      // them, and a translated subject is a second place a newline could enter.
      const message = buildInvitationEmail({
        ...invitation,
        workspaceName: 'Engine\r\nBcc: attacker@example.test',
        locale,
      });

      expect(message.subject).not.toMatch(/[\r\n]/);
    });

    it('writes a single-line subject on both emails', () => {
      expect(buildInvitationEmail({ ...invitation, locale }).subject).not.toMatch(/[\r\n]/);
      expect(buildVerificationEmail({ ...verification, locale }).subject).not.toMatch(/[\r\n]/);
    });

    it('escapes a markup-carrying workspace name', () => {
      const message = buildInvitationEmail({
        ...invitation,
        workspaceName: '<img src=x onerror="alert(1)">',
        locale,
      });

      expect(message.html).not.toContain('<img');
    });

    it('carries the action link in the text body of both emails', () => {
      // A translation that loses the URL leaves the recipient with a sentence and no way to
      // act on it — the one failure that makes the email worthless rather than merely awkward.
      expect(buildInvitationEmail({ ...invitation, locale }).text).toContain(invitation.acceptUrl);
      expect(buildVerificationEmail({ ...verification, locale }).text).toContain(
        verification.verificationUrl,
      );
    });

    it('leaves no blank line where a sentence should be', () => {
      const message = buildInvitationEmail({ ...invitation, locale });

      for (const line of message.text.split('\n')) {
        expect(line).not.toMatch(/^\s+$/);
      }
    });
  });
});
