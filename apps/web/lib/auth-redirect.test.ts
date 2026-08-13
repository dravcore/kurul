import { describe, expect, it } from 'vitest';
import {
  AFTER_LOGIN_PATH,
  AFTER_REGISTER_PATH,
  NEXT_PARAM,
  safeNextPath,
  withNextParam,
} from './auth-redirect';

describe('safeNextPath', () => {
  it('keeps a same-origin path so the visitor lands where they were headed', () => {
    expect(safeNextPath('/invite/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51')).toBe(
      '/invite/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51',
    );
  });

  it('keeps the query string of a deep link', () => {
    expect(safeNextPath('/boards/abc?label=slot-1')).toBe('/boards/abc?label=slot-1');
  });

  it.each([
    ['an absolute URL', 'https://evil.com'],
    ['an absolute URL over plain http', 'http://evil.com/steal'],
    ['a protocol-relative URL', '//evil.com'],
    ['a protocol-relative URL with a path', '//evil.com/invite/1'],
    ['a backslash protocol-relative URL', '/\\evil.com'],
    ['a relative path that could resolve anywhere', 'dashboard'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['an empty value', ''],
    ['no value at all', null],
  ])('refuses %s', (_case, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it('refuses a value browsers would strip back into a protocol-relative URL', () => {
    // A browser drops the tab before resolving, turning this into `//evil.com` — the leading
    // single slash it appears to have is not the one that gets navigated.
    expect(safeNextPath('/\t/evil.com')).toBeNull();
    expect(safeNextPath('/\n/evil.com')).toBeNull();
  });

  it('refuses the decoded form an escaped parameter arrives as', () => {
    // `useSearchParams().get()` hands over the decoded value, so `%2F%2Fevil.com` reaches the
    // check already looking like the protocol-relative URL it is.
    const decoded = new URLSearchParams('next=%2F%2Fevil.com').get('next');

    expect(decoded).toBe('//evil.com');
    expect(safeNextPath(decoded)).toBeNull();
  });
});

describe('withNextParam', () => {
  it('carries an accepted destination across to the other auth screen', () => {
    expect(withNextParam('/register', '/invite/abc')).toBe(
      `/register?${NEXT_PARAM}=${encodeURIComponent('/invite/abc')}`,
    );
  });

  it('drops a destination that would be refused on arrival', () => {
    expect(withNextParam('/register', 'https://evil.com')).toBe('/register');
    expect(withNextParam('/login', null)).toBe('/login');
  });
});

describe('defaults', () => {
  it('sends a sign-in without a destination to the dashboard, a sign-up to workspace creation', () => {
    expect(AFTER_LOGIN_PATH).toBe('/dashboard');
    expect(AFTER_REGISTER_PATH).toBe('/workspaces/new');
  });
});
