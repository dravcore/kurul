import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // The real `redirect` throws a NEXT_REDIRECT control-flow error; a mock that returns
  // would let the page fall through code that never runs in Next.
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import HomePage from './page';

describe('HomePage', () => {
  it('sends a visitor at the root to sign-in', () => {
    expect(() => HomePage()).toThrow('NEXT_REDIRECT:/login');

    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });
});
