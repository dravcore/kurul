import {
  matchLocale,
  negotiateLocale,
  resolveLocale,
  type Locale,
  type UserDto,
} from '@kurultay/shared-types';
import { getApiBaseUrl } from '@/lib/api';

/**
 * Substring identifying Better Auth's session cookie in a raw `Cookie` header.
 *
 * Matched as a substring rather than by exact name so the `__Secure-` prefix the cookie takes
 * over HTTPS is covered by the same check. This is a cheap "is anyone signed in" probe, not an
 * authentication decision — the API is still the only thing that validates the token.
 */
const SESSION_COOKIE_MARKER = 'session_token';

/** Whether the request carries a session at all, so a signed-out render can skip `/me`. */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  return typeof cookieHeader === 'string' && cookieHeader.includes(SESSION_COOKIE_MARKER);
}

/**
 * The signed-in user's stored language preference, or `null`.
 *
 * Never throws and never rejects. This runs inside `getRequestConfig`, so anything that
 * escapes here fails the render of every page — an API that is down or slow has to cost the
 * user their preferred language, not the application.
 */
export async function fetchStoredLocale(
  cookieHeader: string | null | undefined,
): Promise<Locale | null> {
  if (!hasSessionCookie(cookieHeader) || !cookieHeader) return null;

  try {
    const response = await fetch(`${getApiBaseUrl()}/me`, {
      headers: { cookie: cookieHeader },
      // The answer is per-user; a cached one would hand the first renderer's language to
      // everyone behind the same cache entry.
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const user = (await response.json()) as UserDto | null;
    return matchLocale(user?.locale);
  } catch {
    return null;
  }
}

export interface LocaleRequestInput {
  /** Raw `Cookie` header, forwarded to `/me`. */
  cookieHeader: string | null | undefined;
  /** Value of the locale cookie, the browser-side mirror of `User.locale`. */
  localeCookie: string | null | undefined;
  /** Raw `Accept-Language` header. */
  acceptLanguage: string | null | undefined;
}

/**
 * `User.locale` → locale cookie → `Accept-Language` → `'en'`.
 *
 * The chain from [ADR 0018](../../../docs/decisions/0018-localization-strategy.md), and the
 * reason there is no `[locale]` path segment: nothing in this app is indexed, so the routing
 * variant buys only SEO while costing the whole route tree and a rewrite of the auth
 * middleware's literal path matching.
 *
 * The database link comes first because it is the preference of record — a user who switches
 * language on one machine should find the other one already switched. It costs one request to
 * `/me`, skipped entirely when nobody is signed in, which is also what lets an invitee open
 * `/invite/…` in their own language with no account at all.
 *
 * The cookie is not merely a cache of the stored value: it is what a signed-out visitor and a
 * pre-`/me` render have to go on, and it is written alongside the database on every change.
 */
export async function resolveRequestLocale(input: LocaleRequestInput): Promise<Locale> {
  const stored = await fetchStoredLocale(input.cookieHeader);

  return resolveLocale([stored, input.localeCookie, negotiateLocale(input.acceptLanguage)]);
}
