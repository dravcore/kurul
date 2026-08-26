import {
  buildInviteAcceptUrl,
  buildTaskUrl,
  resolvePasswordResetUrl,
  resolveVerificationUrl,
  webAppUrl,
} from './web-urls';

const VERIFY_BASE = 'http://localhost:4000/auth/verify-email?token=a-jwt';
/** The exact shape Better Auth 1.7 hands `sendResetPassword` when no `redirectTo` was given. */
const RESET_BASE = 'http://localhost:4000/auth/reset-password/opaque-token?callbackURL=';

describe('web app URLs', () => {
  const original = process.env.WEB_URL;

  beforeEach(() => {
    process.env.WEB_URL = 'https://app.example.test';
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.WEB_URL;
    } else {
      process.env.WEB_URL = original;
    }
  });

  describe('webAppUrl', () => {
    it('falls back to the local web app', () => {
      delete process.env.WEB_URL;
      expect(webAppUrl()).toBe('http://localhost:3000');
    });

    it('drops a trailing slash so joined paths never double up', () => {
      process.env.WEB_URL = 'https://app.example.test/';
      expect(webAppUrl()).toBe('https://app.example.test');
    });
  });

  describe('buildInviteAcceptUrl', () => {
    it('points at the web invitation page', () => {
      expect(buildInviteAcceptUrl('0199f0d2-0000-7000-8000-000000000001')).toBe(
        'https://app.example.test/invite/0199f0d2-0000-7000-8000-000000000001',
      );
    });
  });

  describe('resolveVerificationUrl', () => {
    it('sends the user to the web verification page when no callback was chosen', () => {
      const resolved = new URL(resolveVerificationUrl(VERIFY_BASE));

      expect(resolved.searchParams.get('callbackURL')).toBe(
        'https://app.example.test/verify-email',
      );
      expect(resolved.searchParams.get('token')).toBe('a-jwt');
    });

    it('treats the Better Auth default of "/" as no choice at all', () => {
      const resolved = new URL(resolveVerificationUrl(`${VERIFY_BASE}&callbackURL=%2F`));

      expect(resolved.searchParams.get('callbackURL')).toBe(
        'https://app.example.test/verify-email',
      );
    });

    it('resolves a relative callback against the web app, not the API', () => {
      const resolved = new URL(resolveVerificationUrl(`${VERIFY_BASE}&callbackURL=%2Fdashboard`));

      expect(resolved.searchParams.get('callbackURL')).toBe('https://app.example.test/dashboard');
    });

    it('leaves an absolute callback for the Better Auth origin check to judge', () => {
      const url = `${VERIFY_BASE}&callbackURL=${encodeURIComponent('https://app.example.test/invite/abc')}`;

      expect(resolveVerificationUrl(url)).toBe(url);
    });

    it('returns a non-URL untouched rather than dropping the email', () => {
      expect(resolveVerificationUrl('not a url')).toBe('not a url');
    });
  });

  describe('resolvePasswordResetUrl', () => {
    it('sends the user to the web reset page when the client named no redirect', () => {
      const resolved = new URL(resolvePasswordResetUrl(RESET_BASE));

      // The token stays in the path: the API still checks it before redirecting.
      expect(resolved.pathname).toBe('/auth/reset-password/opaque-token');
      expect(resolved.searchParams.get('callbackURL')).toBe(
        'https://app.example.test/reset-password',
      );
    });

    it('resolves a relative redirect against the web app, not the API', () => {
      const resolved = new URL(resolvePasswordResetUrl(`${RESET_BASE}%2Freset-password`));

      expect(resolved.searchParams.get('callbackURL')).toBe(
        'https://app.example.test/reset-password',
      );
    });

    it('leaves an absolute redirect for the Better Auth origin check to judge', () => {
      const url = `${RESET_BASE}${encodeURIComponent('https://app.example.test/reset-password')}`;

      expect(resolvePasswordResetUrl(url)).toBe(url);
    });

    it('returns a non-URL untouched rather than dropping the email', () => {
      expect(resolvePasswordResetUrl('not a url')).toBe('not a url');
    });
  });

  describe('buildTaskUrl', () => {
    it('points at the card under its board on the web app', () => {
      expect(buildTaskUrl('board-1', 'task-1')).toBe(
        'https://app.example.test/board/board-1/task/task-1',
      );
    });
  });
});
