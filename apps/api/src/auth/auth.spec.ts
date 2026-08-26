import { MailDeliveryStatus } from '@kurul/shared-types';
import { DEMO_USER_EMAIL } from '../demo/demo-dataset';
import type { MailMessage } from '../mail/mail-sender';
import * as sendMailModule from '../mail/send-mail';
import { auth } from './auth';

// The hook resolves the recipient's stored language through Prisma; there is no database
// behind a unit test, and the rule itself is covered by `recipient-locale.spec.ts`.
jest.mock('../mail/stored-locale', () => ({
  readStoredLocale: jest.fn(() => Promise.resolve(null)),
}));

describe('auth options', () => {
  it('pins session.cookieCache.maxAge to 60 seconds (SEC-01)', () => {
    // This is the entire revocation window for password changes, admin force-delete, and a
    // stolen `session_data` cookie: Better Auth answers `getSession` from the signed cookie
    // without a database read until this expires (see the comment on
    // `SESSION_COOKIE_CACHE_MAX_AGE_SECONDS` in `auth.ts`). Pinned rather than left to float —
    // widening it silently reopens a window every doc in the repo describes as ~60s.
    expect(auth.options.session?.cookieCache?.maxAge).toBe(60);
  });

  it('leaves session.cookieCache enabled', () => {
    // The cache still exists — the fix narrows the window, it does not remove the DB-read
    // savings that motivated it.
    expect(auth.options.session?.cookieCache?.enabled).toBe(true);
  });

  it('lets a reset link work for one hour, once, and ends every session when it is used', () => {
    // The hour is what the email promises in words (`buildPasswordResetEmail`); the revocation
    // is what makes a reset a way to take an account back rather than only to remember it.
    expect(auth.options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(3600);
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });
});

describe('sendResetPassword', () => {
  const hook = auth.options.emailAndPassword?.sendResetPassword;
  const user = {
    id: '0199f0d2-0000-7000-8000-000000000001',
    email: 'forgetful@example.test',
    name: 'Ada',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  /** The exact shape Better Auth 1.7 hands the hook when the client passed no `redirectTo`. */
  const betterAuthUrl = 'http://localhost:4000/auth/reset-password/opaque?callbackURL=';
  const originalEnv = { DEMO_MODE: process.env.DEMO_MODE, WEB_URL: process.env.WEB_URL };
  let sendMail: jest.SpyInstance;

  beforeEach(() => {
    process.env.WEB_URL = 'https://app.example.test';
    sendMail = jest
      .spyOn(sendMailModule, 'sendMail')
      .mockResolvedValue(MailDeliveryStatus.NOT_CONFIGURED);
  });

  afterEach(() => {
    sendMail.mockRestore();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('is configured, so /auth/request-password-reset is not RESET_PASSWORD_DISABLED', () => {
    expect(typeof hook).toBe('function');
  });

  it('mails a link whose callback lands on the web app, in the recipient language', async () => {
    const request = new Request('http://localhost:4000/auth/request-password-reset', {
      headers: { 'accept-language': 'tr' },
    });

    await hook!({ user, url: betterAuthUrl, token: 'opaque' }, request);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]![0] as MailMessage;
    expect(message.to).toBe(user.email);
    expect(message.subject).toContain('sıfırlayın');
    const link = new URL(message.text.split('\n').find((line) => line.startsWith('http'))!);
    // The token stays on the API, which checks it; only the hand-off afterwards moves.
    expect(link.origin).toBe('http://localhost:4000');
    expect(link.pathname).toBe('/auth/reset-password/opaque');
    expect(link.searchParams.get('callbackURL')).toBe('https://app.example.test/reset-password');
  });

  it('sends nothing for the demo account while DEMO_MODE is on', async () => {
    process.env.DEMO_MODE = 'true';

    await hook!({ user: { ...user, email: DEMO_USER_EMAIL }, url: betterAuthUrl, token: 'opaque' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('still serves every other account on a demo instance (the log transport takes it)', async () => {
    process.env.DEMO_MODE = 'true';

    await hook!({ user, url: betterAuthUrl, token: 'opaque' });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('serves the demo address like any other when DEMO_MODE is off', async () => {
    // A self-hosted instance may well have a real `demo@kurul.dev`-shaped account; the skip is
    // about the published fixture, not about the address.
    delete process.env.DEMO_MODE;

    await hook!({ user: { ...user, email: DEMO_USER_EMAIL }, url: betterAuthUrl, token: 'opaque' });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
