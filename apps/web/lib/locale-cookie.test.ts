import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE_MAX_AGE_SECONDS } from '@kurul/shared-types';
import { buildLocaleCookie, writeLocaleCookie } from './locale-cookie';

describe('buildLocaleCookie', () => {
  it('writes the chosen language at the site root', () => {
    const cookie = buildLocaleCookie('en', false);

    expect(cookie).toContain('locale=en');
    // Anything narrower is invisible to the render that has to read it.
    expect(cookie).toContain('path=/');
  });

  it('outlives the session, because it mirrors a stored preference', () => {
    expect(buildLocaleCookie('en', false)).toContain(`max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
  });

  it('expires the cookie when the preference is cleared', () => {
    // "Follow my browser" has to remove the mirror, or the old choice keeps winning over
    // Accept-Language on every render.
    const cookie = buildLocaleCookie(null, false);

    expect(cookie).toContain('locale=');
    expect(cookie).toContain('max-age=0');
  });

  it('uses lax rather than strict, so an invitation link keeps the language', () => {
    expect(buildLocaleCookie('en', false)).toContain('samesite=lax');
  });

  it('adds the secure flag only over HTTPS', () => {
    expect(buildLocaleCookie('en', true)).toContain('secure');
    // Local development is plain HTTP; a `secure` cookie there is silently dropped.
    expect(buildLocaleCookie('en', false)).not.toContain('secure');
  });
});

describe('writeLocaleCookie', () => {
  it('puts the language in the document jar', () => {
    writeLocaleCookie('en');

    expect(document.cookie).toContain('locale=en');
  });
});
