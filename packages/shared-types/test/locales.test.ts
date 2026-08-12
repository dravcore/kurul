import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  isLocale,
  matchLocale,
  negotiateLocale,
  resolveLocale,
} from '../src/locales.js';

/**
 * The locale vocabulary is shared because both sides read it: the web renders the picker and
 * resolves the interface language from it, the API validates `PATCH /me` against it and picks
 * the language it seeds a board's columns in. A second copy on either side is how the two
 * ends up disagreeing about which languages exist.
 */
describe('SUPPORTED_LOCALES', () => {
  it('lists at least one locale and includes the default', () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('holds no duplicates', () => {
    expect(new Set(SUPPORTED_LOCALES).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('spells every entry as a lowercase IETF language tag', () => {
    // The tag is stored in `User.locale`, sent as a cookie value and passed to `Intl.*`.
    // Mixed casing there would make `matchLocale` miss its own list.
    for (const locale of SUPPORTED_LOCALES) {
      expect(locale).toMatch(/^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/);
    }
  });
});

describe('isLocale', () => {
  it('accepts every supported tag', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it('rejects an unsupported tag, and anything that is not a string', () => {
    expect(isLocale('zz')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it('rejects a region subtag that is not itself supported', () => {
    // `en-GB` is a valid thing for a browser to ask for, but it is not a catalog we ship.
    // `matchLocale` is what widens it to `en`; `isLocale` stays exact so that the value
    // written to `User.locale` is always one we can load messages for.
    expect(isLocale('en-GB')).toBe(false);
  });
});

describe('matchLocale', () => {
  it('returns a supported tag unchanged', () => {
    expect(matchLocale('en')).toBe('en');
  });

  it('falls back from a region subtag to its base language', () => {
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('en-US')).toBe('en');
  });

  it('is case-insensitive about the tag it is handed', () => {
    // Browsers and proxies are not consistent about this, and `Accept-Language` is
    // case-insensitive per RFC 9110.
    expect(matchLocale('EN')).toBe('en');
    expect(matchLocale('en-gb')).toBe('en');
  });

  it('returns null for an unsupported language, a wildcard, or nothing at all', () => {
    expect(matchLocale('zz')).toBeNull();
    expect(matchLocale('*')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(null)).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe('negotiateLocale', () => {
  it('picks the first supported language in the header', () => {
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
  });

  it('honours q-values rather than written order', () => {
    // A browser is free to list a low-weighted language first; taking the written order
    // would hand that user the language they ranked last.
    expect(negotiateLocale('zz;q=0.2,en;q=0.9')).toBe('en');
  });

  it('skips languages it does not support', () => {
    expect(negotiateLocale('zz,yy,en')).toBe('en');
  });

  it('treats a missing q-value as q=1', () => {
    expect(negotiateLocale('zz;q=0.9,en')).toBe('en');
  });

  it('ignores an entry weighted q=0, which means "not acceptable"', () => {
    expect(negotiateLocale('en;q=0')).toBeNull();
  });

  it('returns null when nothing in the header is supported', () => {
    expect(negotiateLocale('zz,yy;q=0.5')).toBeNull();
    expect(negotiateLocale('*')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });

  it('survives a malformed header instead of throwing', () => {
    // This value arrives from the network; a parse error here would break every render.
    expect(negotiateLocale(';;;,,,q=')).toBeNull();
    expect(negotiateLocale('en;q=notanumber')).toBe('en');
  });

  it('keeps written order between entries of equal weight', () => {
    // Stable, so two equally-weighted supported languages resolve predictably rather than
    // depending on the engine's sort.
    expect(negotiateLocale('en;q=0.5,en-GB;q=0.5')).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('takes the first candidate that names a supported locale', () => {
    expect(resolveLocale(['en'])).toBe('en');
  });

  it('skips absent and unsupported candidates', () => {
    // This is the shape of the chain itself: `User.locale` may be null, the cookie may be
    // missing, and the header may name nothing we ship.
    expect(resolveLocale([null, undefined, '', 'zz', 'en'])).toBe('en');
  });

  it('widens a region subtag the same way matchLocale does', () => {
    expect(resolveLocale(['en-GB'])).toBe('en');
  });

  it('falls back to the default when no candidate matches', () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([null, 'zz'])).toBe(DEFAULT_LOCALE);
  });
});

describe('LOCALE_COOKIE_NAME', () => {
  it('is a plain cookie-safe token', () => {
    // Both sides hardcode nothing: the web writes this cookie and `i18n/request.ts` reads it.
    expect(LOCALE_COOKIE_NAME).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
