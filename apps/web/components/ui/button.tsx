import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-body font-strong whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&[data-loading]>svg]:hidden",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive: 'bg-destructive text-white hover:bg-destructive-hover dark:bg-destructive/60',
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

/** 14px, currentColor so every variant keeps its own contrast; rotation comes from the
 * `[data-slot='button-spinner']` keyframe in app/globals.css, not from a class here, so the
 * reduced-motion twin lives in exactly one place. */
function ButtonSpinner(): React.ReactElement {
  return (
    <svg
      data-slot="button-spinner"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * After 400ms, replaces the leading icon (or, on an icon-less button, an always-present
     * reserved slot) with a 14px spinner, and marks the button `aria-busy` and `disabled`
     * meanwhile. The label text never changes and the icon slot is reserved from the moment
     * `loading` turns true, so the 400ms delay against flicker on a fast response does not
     * also cost a layout shift on a slow one.
     *
     * Ignored on `asChild`: the rendered element is the caller's own (typically a link), which
     * has no button disabled/aria-busy story for this component to add to.
     */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  const isLoading = loading && !asChild;
  const [showSpinner, setShowSpinner] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setShowSpinner(true), 400);
    // Runs on unmount and on every `isLoading` flip (a fast response arriving before 400ms
    // included), so the timer set above is always the one it clears.
    return () => {
      clearTimeout(timer);
      setShowSpinner(false);
    };
  }, [isLoading]);

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={isLoading ? '' : undefined}
      aria-busy={isLoading ? true : undefined}
      disabled={isLoading || disabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {isLoading ? (
        <>
          <span
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center',
              !showSpinner && 'invisible',
            )}
          >
            {showSpinner ? <ButtonSpinner /> : null}
          </span>
          {children}
        </>
      ) : (
        // `asChild` hands `children` straight to `Slot.Root`, which requires exactly one
        // element child (Radix's `React.Children.only`): the loading fragment above would
        // break that even with an empty spinner slot, so this branch stays a bare pass-through.
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
