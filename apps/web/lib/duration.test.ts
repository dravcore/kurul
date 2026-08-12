import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import messages from '@/messages/en.json';
import { formatEstimate, type EstimateTranslator } from './duration';

const t = createTranslator({
  locale: 'en',
  messages,
  namespace: 'app.board.task',
});

describe('formatEstimate', () => {
  // docs/design.md §7: "`estimatedMinutes` renders "2h 30m", never "150"."
  it.each([
    // input   expected      why
    [0, '0m', 'zero is a duration, not an absence — the caller decides whether to render it'],
    [1, '1m', 'smallest positive value'],
    [45, '45m', 'under an hour stays in minutes'],
    [59, '59m', 'last minute before the hour'],
    [60, '1h', 'exactly one hour drops the minutes'],
    [90, '1h 30m', 'the mixed case'],
    [120, '2h', 'a whole hour count never renders "2h 0m"'],
    [150, '2h 30m', 'the reported bug: was "150m"'],
    [600, '10h', 'two-digit whole hours'],
    [1439, '23h 59m', 'one minute short of a day'],
    [1440, '24h', 'a full day stays in hours — no day unit exists'],
    [6000, '100h', 'three-digit whole hours'],
    [100_000, '1666h 40m', 'absurdly large but still legible'],
  ])('formats %i minutes as "%s" (%s)', (minutes, expected) => {
    expect(formatEstimate(minutes, t)).toBe(expected);
  });

  // An estimate is minutes of work; the API has no reason to send anything else, but the card
  // renders whatever it is handed and a minus sign or a "1.5h 30m" on a board would be worse
  // than a floor of zero.
  it.each([
    [-1, '0m', 'a negative estimate clamps rather than rendering "-1m"'],
    [-150, '0m', 'a large negative clamps too'],
    [90.7, '1h 30m', 'a fractional minute truncates instead of leaking a decimal'],
    [59.9, '59m', 'truncation never rounds up into the next hour'],
    [Number.NaN, '0m', 'a non-number degrades to zero'],
    [Number.POSITIVE_INFINITY, '0m', 'a non-finite value degrades to zero'],
  ])('guards %s into "%s" (%s)', (minutes, expected) => {
    expect(formatEstimate(minutes, t)).toBe(expected);
  });

  it('lets the catalogue own word order rather than the helper', () => {
    // The point of three whole-phrase keys instead of `${h}h ${m}m`: a translator can reorder
    // the parts, change the separator, or drop one entirely. Turkish is the first pack, and a
    // hardcoded join would make this impossible to express.
    // A stand-in for a future tr.json. The helper's whole contract is "choose a key, hand it
    // named values" — so a translator that arranges those values differently is all it takes to
    // show the arrangement is not the helper's. (ICU rendering itself is covered by the table
    // above, which goes through the real en.json.)
    const reordered: EstimateTranslator = (key, values = {}) => {
      if (key === 'estimateFormat.hours') return `${values.hours} saat`;
      if (key === 'estimateFormat.minutes') return `${values.minutes} dakika`;
      return `${values.minutes} dakika + ${values.hours} saat`;
    };

    expect(formatEstimate(150, reordered)).toBe('30 dakika + 2 saat');
    expect(formatEstimate(120, reordered)).toBe('2 saat');
    expect(formatEstimate(30, reordered)).toBe('30 dakika');
  });
});
