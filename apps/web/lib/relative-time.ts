const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/**
 * Compact relative time for activity / notification lists.
 *
 * `locale` is a parameter rather than a `useLocale()` call inside: this has to stay a plain
 * function so it can be used from a server component and pinned in tests without an intl
 * provider, and it matches how `TaskCard` already threads the locale into `Intl.DateTimeFormat`.
 * Client callers pass `useLocale()`.
 */
export function formatRelativeTime(iso: string, locale: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === 'second') {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }

  return new Date(iso).toLocaleString(locale);
}
