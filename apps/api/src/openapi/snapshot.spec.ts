import { firstDifference } from './snapshot';

/**
 * `serialise` is deliberately absent from this file, and it is worth saying why rather than
 * leaving a gap somebody has to rediscover.
 *
 * It cannot run under Jest. `prettier`'s CommonJS entry performs a dynamic `import()` of its own
 * internals, and Jest's CommonJS module VM answers that with
 * `A dynamic import callback was invoked without --experimental-vm-modules` — measured, not
 * assumed. The flag that would fix it is exactly the one `jest.config.cjs` records rejecting
 * once already, for `customExportConditions`: it changes module resolution for every dual
 * published dependency in the tree, to buy one function a test.
 *
 * Two instruments already cover it, and between them they are stronger than the test would be.
 * `pnpm openapi:check` re-serialises the whole document on every CI build and byte-compares it
 * with the committed file, so a `serialise` that changed its output fails the gate. And
 * `pnpm format:check` runs prettier over `apps/api/openapi.json` itself, so a `serialise` that
 * disagreed with prettier fails *that* — which is the specific failure the function exists to
 * prevent. Both would have to be wrong in the same direction for a defect to survive.
 */
describe('firstDifference', () => {
  it('numbers lines from one, not from zero', () => {
    // The number in this message gets pasted into an editor's go-to-line box. Off by one and it
    // sends the reader to the line above the problem, every time, forever.
    const message = firstDifference('a\nb\nc', 'a\nB\nc');

    expect(message).toContain('first difference at line 2');
    expect(message).toContain('committed: b');
    expect(message).toContain('generated: B');
  });

  it('reports the first difference and not a later one', () => {
    const message = firstDifference('a\nb\nc', 'A\nB\nC');

    expect(message).toContain('first difference at line 1');
  });

  it('says which side ran out when the generated document is shorter', () => {
    const message = firstDifference('a\nb', 'a');

    expect(message).toContain('first difference at line 2');
    expect(message).toContain('committed: b');
    expect(message).toContain('generated: <end of file>');
  });

  it('says which side ran out when the committed document is shorter', () => {
    const message = firstDifference('a', 'a\nb');

    expect(message).toContain('committed: <end of file>');
    expect(message).toContain('generated: b');
  });

  it('does not throw on identical input, it says so', () => {
    expect(firstDifference('a\nb', 'a\nb')).toBe('  the two documents are identical');
  });
});
