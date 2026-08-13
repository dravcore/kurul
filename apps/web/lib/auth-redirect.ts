/**
 * Where an auth screen sends the visitor once they are signed in.
 *
 * Two places already write the destination into the URL: `middleware.ts`, when it bounces a
 * signed-out visitor off a protected route, and the invitation screen, which sends an invitee
 * to sign in before they can accept. Both were writing `?next=…` into a URL that read it
 * nowhere, so an invitee who followed the link landed on a generic page and had to find the
 * invitation email again. This module is the one place that parameter is written and read, so
 * the two ends cannot drift apart.
 */

/** The query parameter carrying the page the visitor was heading for. */
export const NEXT_PARAM = 'next';

/** Where signing in lands when the URL asks for nothing in particular. */
export const AFTER_LOGIN_PATH = '/dashboard';

/**
 * Where a brand-new account lands when the URL asks for nothing in particular.
 *
 * A fresh account has no workspace, so the dashboard would be empty — creation comes first.
 * An invitee is the exception the `next` parameter exists for: they are joining someone
 * else's workspace and should go back to the invitation instead.
 */
export const AFTER_REGISTER_PATH = '/workspaces/new';

/**
 * Whether the value carries a character browsers strip out of a URL before resolving it.
 *
 * Left in, those characters are a way past the checks below: a tab wedged between the two
 * leading slashes makes the value start with a single slash *as written*, and leaves the
 * protocol-relative `//evil.com` by the time it is navigated. A legitimate destination in this
 * app never contains a control character or a bare space, so finding one is enough to refuse
 * the whole value.
 */
function hasStrippedCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The destination in `?next=…`, or `null` when there is nothing safe to honour.
 *
 * Anything reaching this function came out of the address bar, so it is attacker-supplied: a
 * link to `/login?next=https://evil.com` would otherwise turn our own sign-in form into a
 * credible phishing hop — the victim signs in *at the real site* and is handed to the attacker
 * immediately afterwards. Only a same-origin absolute path is accepted, which rules out both
 * the absolute URL and its quieter cousin, the protocol-relative `//evil.com` (and
 * `/\evil.com`, which browsers resolve the same way).
 *
 * Refusing is never fatal: every caller falls back to its normal destination, so a bad value
 * costs the visitor a redirect, not access.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (hasStrippedCharacter(value)) {
    return null;
  }
  if (!value.startsWith('/')) {
    return null;
  }
  if (value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }
  return value;
}

/**
 * `path` with the destination attached, or `path` alone when there is none worth carrying.
 *
 * The value is validated on the way *out* as well as on the way in, so a rejected destination
 * is dropped at the link that would have propagated it, rather than being handed on to be
 * refused a page later.
 */
export function withNextParam(path: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === null ? path : `${path}?${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}
