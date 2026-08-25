import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Multi-line text field, styled as the tall sibling of `Input`.
 *
 * `min-h-20` is the floor, not the height: callers set `rows` and may raise it with a
 * `min-h-*` of their own through `className`.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // `text-base md:text-body`, not `text-body` alone, for the reason `Input` carries the
        // same pair: 16px is the threshold under which iOS Safari zooms the page on focus.
        'w-full min-w-0 min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-body',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
