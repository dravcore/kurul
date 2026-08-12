import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStoredLocale, hasSessionCookie, resolveRequestLocale } from './user-locale';

const SESSION_COOKIE = 'better-auth.session_token=abc123';

describe('hasSessionCookie', () => {
  it('recognises the session cookie Better Auth sets', () => {
    expect(hasSessionCookie(SESSION_COOKIE)).toBe(true);
  });

  it('recognises the __Secure- prefixed form used over HTTPS', () => {
    expect(hasSessionCookie('__Secure-better-auth.session_token=abc123')).toBe(true);
  });

  it('is false for a jar holding only the locale mirror', () => {
    // A signed-out visitor who once picked a language still sends a cookie. Treating that as
    // a session would spend a 401 round trip on every render of the sign-in page.
    expect(hasSessionCookie('locale=en')).toBe(false);
  });

  it('is false when there is no cookie header at all', () => {
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
  });
});

describe('fetchStoredLocale', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 401,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  it('returns the language stored on the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', locale: 'en' }));

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBe('en');
  });

  it('forwards the caller’s cookies, since /me is session-scoped', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', locale: 'en' }));

    await fetchStoredLocale(SESSION_COOKIE);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toBe(SESSION_COOKIE);
    // A cached read would pin the language to whoever rendered first.
    expect(init.cache).toBe('no-store');
  });

  it('does not call the API at all without a session cookie', async () => {
    await expect(fetchStoredLocale('locale=en')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the user never chose a language', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', locale: null }));

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBeNull();
  });

  it('returns null on a rejected session rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, false));

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBeNull();
  });

  it('returns null when the API is unreachable', async () => {
    // Every page render goes through this. An API outage must degrade the language, not
    // blank the app.
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBeNull();
  });

  it('returns null when the body is not the shape it claims', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response);

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBeNull();
  });

  it('ignores a stored tag the app no longer ships', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', locale: 'zz' }));

    await expect(fetchStoredLocale(SESSION_COOKIE)).resolves.toBeNull();
  });
});

describe('resolveRequestLocale', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function storedLocale(locale: string | null): void {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'u1', locale }),
    } as unknown as Response);
  }

  it('prefers the stored preference over the cookie and the header', async () => {
    // The chain ADR 0018 specifies: User.locale → cookie → Accept-Language → 'en'. The
    // database is the preference of record, so a device carrying an older cookie follows
    // the choice the user made elsewhere.
    storedLocale('en');

    await expect(
      resolveRequestLocale({
        cookieHeader: SESSION_COOKIE,
        localeCookie: 'zz',
        acceptLanguage: 'zz',
      }),
    ).resolves.toBe('en');
  });

  it('falls back to the cookie when nothing is stored', async () => {
    storedLocale(null);

    await expect(
      resolveRequestLocale({
        cookieHeader: SESSION_COOKIE,
        localeCookie: 'en',
        acceptLanguage: 'zz',
      }),
    ).resolves.toBe('en');
  });

  it('falls back to Accept-Language for a signed-out visitor', async () => {
    // This is what lets an invitee open /invite/… in their own language without an account
    // — the case that kept the app off URL-segment routing in the first place.
    await expect(
      resolveRequestLocale({
        cookieHeader: null,
        localeCookie: null,
        acceptLanguage: 'en-GB,en;q=0.9',
      }),
    ).resolves.toBe('en');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to English when no link in the chain resolves', async () => {
    await expect(
      resolveRequestLocale({
        cookieHeader: null,
        localeCookie: null,
        acceptLanguage: null,
      }),
    ).resolves.toBe('en');
  });

  it('ignores a cookie naming a language the app does not ship', async () => {
    // The cookie is client-writable; a hand-edited value must not reach the catalog import.
    await expect(
      resolveRequestLocale({
        cookieHeader: null,
        localeCookie: '../../etc/passwd',
        acceptLanguage: null,
      }),
    ).resolves.toBe('en');
  });
});
