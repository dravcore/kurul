import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  type Locale,
} from '@kurultay/shared-types';

/**
 * Builds the `document.cookie` assignment mirroring the language choice into the browser.
 *
 * Separate from the write so the serialization is testable without a DOM, and so the flags are
 * stated in one place:
 *
 * - `path=/` — every route reads it; a cookie scoped to `/settings` would be invisible to the
 *   render that needs it.
 * - `max-age` — this mirrors a stored preference, so it must outlive the session. Passing
 *   `null` expires it instead, which is how "follow my browser" gets back to reading
 *   `Accept-Language`.
 * - `samesite=lax` — the cookie only ever has to survive top-level navigation. `strict` would
 *   drop it when a user arrives from an invitation link, which is exactly when getting the
 *   language right matters most.
 * - No `httponly`: this is deliberately readable by the client that writes it, and it carries
 *   no authority — the API validates every locale it stores.
 */
export function buildLocaleCookie(locale: Locale | null, secure: boolean): string {
  const parts = [
    `${LOCALE_COOKIE_NAME}=${locale ?? ''}`,
    'path=/',
    `max-age=${locale === null ? 0 : LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    'samesite=lax',
  ];
  if (secure) parts.push('secure');
  return parts.join('; ');
}

/**
 * Mirrors the chosen language into a cookie the server render can read.
 *
 * Written alongside `User.locale`, never instead of it: the database is what outbound email
 * reads, and the cookie is what a signed-out or pre-`/me` render has to go on
 * (docs/decisions/0018-localization-strategy.md).
 */
export function writeLocaleCookie(locale: Locale | null): void {
  document.cookie = buildLocaleCookie(locale, window.location.protocol === 'https:');
}
