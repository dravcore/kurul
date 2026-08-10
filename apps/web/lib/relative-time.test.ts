import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('picks the largest unit that fits', () => {
    expect(formatRelativeTime(isoAgo(45 * 1000), 'en', NOW)).toBe('45 seconds ago');
    expect(formatRelativeTime(isoAgo(5 * 60 * 1000), 'en', NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(isoAgo(3 * 60 * 60 * 1000), 'en', NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(isoAgo(2 * 24 * 60 * 60 * 1000), 'en', NOW)).toBe('2 days ago');
    expect(formatRelativeTime(isoAgo(400 * 24 * 60 * 60 * 1000), 'en', NOW)).toBe('last year');
  });

  it('formats a future timestamp in the other direction', () => {
    expect(formatRelativeTime(new Date(NOW + 2 * 60 * 60 * 1000).toISOString(), 'en', NOW)).toBe(
      'in 2 hours',
    );
  });

  it('follows the locale it is given rather than defaulting to English', () => {
    expect(formatRelativeTime(isoAgo(3 * 60 * 60 * 1000), 'tr', NOW)).toBe('3 saat önce');
    // Exact CLDR wording per unit moves between ICU versions; that it is not the English
    // string is the property this guards.
    expect(formatRelativeTime(isoAgo(2 * 24 * 60 * 60 * 1000), 'tr', NOW)).not.toBe('2 days ago');
  });

  it('returns the raw input when it is not a date', () => {
    expect(formatRelativeTime('not-a-date', 'en', NOW)).toBe('not-a-date');
  });
});
