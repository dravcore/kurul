import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Skeleton } from './skeleton';

afterEach(cleanup);

/**
 * The pulse itself (1.6s, opacity 1.0 to 0.6, its own `prefers-reduced-motion` twin) is written
 * as a real keyframe in `app/globals.css` bound through `[data-slot='skeleton']`, not as a class
 * here: `app/globals-css-layers.test.ts` checks that. This suite only checks the two things a
 * jsdom render can see: the marker the CSS keys off is present, and Tailwind's own `animate-pulse`
 * utility (2s, 1.0-0.5, no reduced-motion twin) is gone so it cannot double up with it.
 */
describe('Skeleton', () => {
  it('carries the data-slot the CSS keyframe keys off', () => {
    const { container } = render(<Skeleton />);
    const element = container.firstElementChild;

    expect(element?.getAttribute('data-slot')).toBe('skeleton');
  });

  it('does not carry Tailwind’s animate-pulse utility', () => {
    const { container } = render(<Skeleton />);
    const element = container.firstElementChild;

    expect(element?.className).not.toMatch(/\banimate-pulse\b/);
  });

  it('merges a caller className with its own base classes', () => {
    const { container } = render(<Skeleton className="h-5 w-40" />);
    const element = container.firstElementChild;

    expect(element?.className).toContain('h-5');
    expect(element?.className).toContain('w-40');
    expect(element?.className).toContain('rounded-md');
    expect(element?.className).toContain('bg-accent');
  });
});
