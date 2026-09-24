import { holdsMoreValuesThan, MAX_JSON_BODY_VALUES } from './json-value-limit';

/**
 * The count behind the JSON body's value ceiling. The request-level cases, the `413` and what it
 * replaced, are in `configure-app.spec.ts`.
 */
describe('holdsMoreValuesThan', () => {
  it('counts every member and every element, at any depth, and not the body itself', () => {
    // Members `a`, `b` and `c`; the two elements of `b`; `e`, inside the second of them; and `d`,
    // inside `c`: seven values.
    const body = { a: 1, b: [1, { e: null }], c: { d: 'x' } };

    expect(holdsMoreValuesThan(body, 8)).toBe(false);
    expect(holdsMoreValuesThan(body, 7)).toBe(false);
    expect(holdsMoreValuesThan(body, 6)).toBe(true);
    expect(holdsMoreValuesThan({}, 0)).toBe(false);
    expect(holdsMoreValuesThan([], 0)).toBe(false);
  });

  it('has nothing to count in a body that is not an object or an array', () => {
    for (const body of [undefined, null, 'text', 7, true]) {
      expect(holdsMoreValuesThan(body, 0)).toBe(false);
    }
  });

  it('allows 1,000 keys in one object and refuses 1,001', () => {
    const keys = (count: number): Record<string, number> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 1]));

    expect(MAX_JSON_BODY_VALUES).toBe(1000);
    expect(holdsMoreValuesThan(keys(1000), MAX_JSON_BODY_VALUES)).toBe(false);
    expect(holdsMoreValuesThan(keys(1001), MAX_JSON_BODY_VALUES)).toBe(true);
  });

  it('leaves room for the largest body a DTO accepts', () => {
    // `DeleteAccountDto` with the 200 `dispositions` its `@ArrayMaxSize` allows, each with all
    // three of its members: 2 + 200 + 600 = 802 values. Every other body DTO declares at most 7.
    const disposition = {
      workspaceId: '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d',
      action: 'transfer',
      newOwnerUserId: '0198e2c1-9a11-7c40-8f2b-1d3e5a7c9b02',
    };
    const body = { confirmEmail: 'owner@example.com', dispositions: Array(200).fill(disposition) };

    expect(holdsMoreValuesThan(body, 802)).toBe(false);
    expect(holdsMoreValuesThan(body, 801)).toBe(true);
    expect(holdsMoreValuesThan(body, MAX_JSON_BODY_VALUES)).toBe(false);
  });

  it('refuses a body nested deeper than it counts, without recursing into it', () => {
    // 100,000 levels, which a recursive walk would overflow the stack on; `ValidationPipe`'s own
    // walk overflowed at 10,000.
    const body = JSON.parse(`${'['.repeat(100_000)}${']'.repeat(100_000)}`) as unknown;

    expect(holdsMoreValuesThan(body, MAX_JSON_BODY_VALUES)).toBe(true);
  });
});
