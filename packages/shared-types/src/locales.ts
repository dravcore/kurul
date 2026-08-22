/**
 * The locales the product ships an interface in, and the matching rules both apps apply.
 *
 * This is shared for the same reason DTOs are: it is a contract across the API boundary. The
 * web renders the language picker from `SUPPORTED_LOCALES` and resolves the interface language
 * with `resolveLocale`; the API validates `PATCH /me` against the same list and negotiates the
 * same `Accept-Language` header when it seeds a board's columns. Two copies of "which languages
 * exist" is how a value the picker offers becomes a value the API rejects.
 *
 * What is *not* here: the message catalogs (`apps/web/messages/<tag>.json`, web-only), the
 * board template catalog with its seed column and label names, and the mail copy
 * (`apps/api/src/common/board-templates.ts` and `apps/api/src/mail/mail-templates.ts`,
 * API-only). See
 * [ADR 0018](../../../docs/decisions/0018-localization-strategy.md).
 */

/**
 * Every locale with a message catalog, in the order the picker lists them.
 *
 * Adding a language is a change to this list — nothing else in the resolution chain is
 * keyed to a specific tag. The places that must grow with it fail to compile or fail a test
 * until they do: the board template catalog's copy table and `MAIL_COPY` in the API are both
 * `Record<Locale, …>`,
 * and `apps/web/messages/<tag>.json` has to exist for the catalog import to resolve — and to
 * carry exactly the keys `en.json` carries, which `messages/catalog.test.ts` gates.
 */
export const SUPPORTED_LOCALES = ['en', 'tr'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The locale used when nothing else resolves.
 *
 * English is canonical (ADR 0018 §4): `messages/en.json` is the source of truth and the only
 * catalog guaranteed to hold every key.
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Name of the cookie mirroring `User.locale` into the browser.
 *
 * The preference lives in the database because outbound email has to know the recipient's
 * language with no request in flight. The cookie exists so a signed-out or pre-hydration
 * render still gets the language the user chose.
 */
export const LOCALE_COOKIE_NAME = 'locale';

/** One year. The cookie is a mirror of a stored preference, not a session artifact. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Narrowing guard: exact membership, no region widening. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves one language tag to a supported locale, widening a region subtag to its base
 * language (`en-GB` → `en`).
 *
 * Widening happens here and not in {@link isLocale} on purpose: a browser legitimately asks
 * for `en-GB`, but the value written to `User.locale` must be a tag we can load a catalog
 * for, so the stored side stays exact.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim().toLowerCase();
  if (!normalized || normalized === '*') return null;
  if (isLocale(normalized)) return normalized;

  const base = normalized.split('-')[0];
  return isLocale(base) ? base : null;
}

interface WeightedTag {
  tag: string;
  quality: number;
}

/**
 * Picks the best supported locale out of an `Accept-Language` header, or `null`.
 *
 * Weight order, not written order: a browser may list a language it barely wants first, and
 * reading the header positionally hands that user the language they ranked last. An entry at
 * `q=0` is an explicit "not acceptable" and is dropped rather than ranked lowest.
 *
 * Never throws — the header comes off the network, and a parse failure here would break every
 * render rather than one request.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const weighted: WeightedTag[] = [];
  for (const part of header.split(',')) {
    const [rawTag, ...params] = part.split(';');
    const tag = rawTag?.trim();
    if (!tag) continue;

    const qParam = params.find((param) => param.trim().toLowerCase().startsWith('q='));
    // An unparseable q is treated as 1 rather than 0: a malformed weight should not silently
    // remove a language the user actually asked for.
    const parsed = qParam === undefined ? 1 : Number.parseFloat(qParam.trim().slice(2));
    const quality = Number.isNaN(parsed) ? 1 : parsed;
    if (quality <= 0) continue;

    weighted.push({ tag, quality });
  }

  // `Array.prototype.sort` is required to be stable, so equal weights keep written order.
  weighted.sort((a, b) => b.quality - a.quality);

  for (const { tag } of weighted) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return null;
}

/**
 * Walks a preference chain and returns the first candidate naming a supported locale.
 *
 * The chain itself is the caller's: the web passes `User.locale`, the locale cookie and the
 * negotiated `Accept-Language` in that order (ADR 0018); the API passes `User.locale` and the
 * negotiated header. Absent links are expected, not exceptional — a user who never picked a
 * language has `null` in the database and no cookie.
 */
export function resolveLocale(candidates: ReadonlyArray<string | null | undefined>): Locale {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}
