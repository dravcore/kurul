import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('lets a consumer override a primitive default from the Kurul type scale', () => {
    // components/ui/input.tsx and friends ship `text-base md:text-body`; a consumer passing
    // `text-small` is choosing the compact size at every width, so `text-base` must drop.
    // tailwind-merge keeps the surviving classes in their original relative order rather than
    // promoting the override to the front, hence `md:text-body` (untouched, different variant)
    // stays ahead of `text-small`.
    expect(cn('text-base md:text-body', 'text-small')).toBe('md:text-body text-small');
  });

  it('lets font-strong override font-semibold', () => {
    expect(cn('font-semibold', 'font-strong')).toBe('font-strong');
  });

  it('keeps two font-size classes that apply at different variants', () => {
    expect(cn('text-body', 'md:text-small')).toBe('text-body md:text-small');
  });
});
