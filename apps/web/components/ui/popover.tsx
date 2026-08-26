'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * shadcn wraps this content in `PopoverPrimitive.Portal`; here it stays where it was written.
 *
 * Its first caller is inside the task panel, and the panel is a hand-rolled layer: it decides
 * whether to hand focus back on close by watching `focusin` against its own subtree, and below
 * `md` it keeps `Tab` inside that subtree by hand (`components/task/use-task-panel-focus.ts`).
 * A portal moves the content to `<body>`, out of both, so focusing the search field inside an
 * open popover would read as focus having left the panel. Radix positions with
 * `position: fixed`, so staying in the tree costs nothing in clipping as long as no ancestor
 * establishes a containing block for fixed descendants.
 *
 * Radix gives this content `role="dialog"`, and a dialog with no accessible name is announced as
 * nothing at all, so every caller owes it an `aria-label` or an `aria-labelledby`.
 *
 * No `outline-*` suppressor and no ring pair: the `@layer base` `:focus-visible` rule in
 * `app/globals.css` is the one focus mark, and a utility here would compile into `utilities` and
 * outrank it.
 */
function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 max-h-(--radix-popover-content-available-height) origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-2 text-popover-foreground shadow-overlay',
        className,
      )}
      {...props}
    />
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
