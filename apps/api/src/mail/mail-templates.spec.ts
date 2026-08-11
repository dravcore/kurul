import { buildInvitationEmail, buildVerificationEmail } from './mail-templates';

describe('buildVerificationEmail', () => {
  const params = {
    to: 'new-user@example.test',
    name: 'Ada Lovelace',
    verificationUrl: 'http://localhost:4000/auth/verify-email?token=jwt&callbackURL=x',
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
});

describe('buildInvitationEmail', () => {
  const params = {
    to: 'invitee@example.test',
    inviterName: 'Ada Lovelace',
    workspaceName: 'Analytical Engine',
    acceptUrl: 'http://localhost:3000/invite/0199f0d2-0000-7000-8000-000000000001',
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
});
