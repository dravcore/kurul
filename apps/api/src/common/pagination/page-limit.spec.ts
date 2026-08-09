import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, clampLimit } from './page-limit';

describe('clampLimit', () => {
  it.each([undefined, null, '', 'abc', NaN, 0, -5])(
    'falls back on an unusable value (%j)',
    (value) => {
      expect(clampLimit(value)).toBe(DEFAULT_PAGE_LIMIT);
    },
  );

  it('accepts a numeric string', () => {
    expect(clampLimit('25')).toBe(25);
  });

  it('truncates a fractional limit rather than rounding up', () => {
    expect(clampLimit(10.9)).toBe(10);
  });

  it('caps at the maximum', () => {
    expect(clampLimit(5000)).toBe(MAX_PAGE_LIMIT);
    expect(clampLimit(Infinity)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('honours a caller-supplied fallback and ceiling', () => {
    expect(clampLimit(undefined, 100)).toBe(100);
    expect(clampLimit(40, DEFAULT_PAGE_LIMIT, 20)).toBe(20);
  });
});
