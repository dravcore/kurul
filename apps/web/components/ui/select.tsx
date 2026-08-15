import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * The native `<select>`, styled to match `Input`.
 *
 * Native on purpose: every one of these is a short, static list of `<option>`s, and the
 * platform control already brings the keyboard model, the type-to-select, the mobile picker
 * and the forced-colors behaviour that a listbox rebuilt in divs has to re-earn. Reach for a
 * Radix `Select` only when the options need markup — icons, two lines, a swatch — which none
 * of them do today.
 *
 * The chevron is drawn as a background image rather than an overlaid icon so it cannot fall
 * out of sync with the control's own disabled and focus states.
 */
const selectVariants = cva(
  cn(
    "w-full min-w-0 appearance-none rounded-md border border-input bg-transparent bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:1rem_1rem] bg-no-repeat text-body shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
  ),
  {
    variants: {
      size: {
        // Right padding leaves room for the chevron; the background position matches it.
        default: 'h-9 pr-8 pl-3 bg-[position:right_0.75rem_center] max-md:min-h-11',
        sm: 'h-8 pr-7 pl-2 bg-[position:right_0.5rem_center] max-md:min-h-11',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

function Select({
  className,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & VariantProps<typeof selectVariants>) {
  return (
    <select
      data-slot="select"
      data-size={size}
      className={cn(selectVariants({ size, className }))}
      {...props}
    />
  );
}

export { Select, selectVariants };
