import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-body font-strong whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive:
          'bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      /**
       * Every size carries a `max-md:` floor of 44px (`h-11` / `size-11`).
       *
       * Below Tailwind's `md` the app is being driven with a thumb, and 44px is the figure
       * `docs/design.md` §4 holds the mobile layout to. Putting the floor in the variant —
       * rather than at the ~40 call sites that spell a size out — is what makes the claim
       * checkable: there is one list to read, and a new button cannot arrive under it by
       * being written somewhere nobody thought to look.
       *
       * The icon sizes take `size-11` (both axes); the text sizes take `min-h-11` and leave
       * width to their content, which is already past 44px by the time a label fits. `min-h`
       * rather than `h` on those so a button that wraps to two lines still grows instead of
       * clipping its own text.
       *
       * Above `md` nothing moves: the desktop scale (24/32/36/40) is unchanged, which is why
       * this is a second declaration and not an edit to the first.
       */
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3 max-md:min-h-11',
        xs: "h-6 gap-1 rounded-md px-2 text-small has-[>svg]:px-1.5 max-md:min-h-11 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 max-md:min-h-11',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4 max-md:min-h-11',
        icon: 'size-9 max-md:size-11',
        'icon-xs': "size-6 rounded-md max-md:size-11 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 max-md:size-11',
        'icon-lg': 'size-10 max-md:size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
