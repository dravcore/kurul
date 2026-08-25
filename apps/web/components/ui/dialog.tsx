'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Radix hands focus back to `DialogTrigger` on close. Every dialog in this app but the mobile
 * drawer is driven by an `open` prop instead of a trigger, so there is nothing for it to hand
 * focus back to and dismissing one drops a keyboard user on `<body>`, against the rule in
 * `docs/design.md` §5 that `Esc` closes the topmost layer and returns focus to whatever opened
 * it. The opener is read in `onOpenAutoFocus`, which Radix fires while focus is still outside
 * the content, and is the trigger itself wherever one is used.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const t = useTranslations('common');
  const openerRef = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onOpenAutoFocus={(event) => {
          const opener = document.activeElement;
          openerRef.current =
            opener instanceof HTMLElement && opener !== document.body ? opener : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const opener = openerRef.current;
          if (event.defaultPrevented || !opener?.isConnected) return;
          // Claims the restore before Radix's own handler, which would reach for the trigger
          // that is not there and leave focus where it fell.
          event.preventDefault();
          opener.focus();
        }}
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-4rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-overlay duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t('close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * The same dialog, docked to an edge instead of centred — the off-canvas drawer.
 *
 * It lives here rather than in a `sheet.tsx` of its own because it is not a second overlay
 * mechanism: it is `DialogPortal` + `DialogOverlay` + `DialogPrimitive.Content`, the three
 * pieces `DialogContent` above is made of, arranged differently. Everything that makes a modal
 * correct — the focus trap, `Escape`, returning focus to the trigger, `aria-modal`, the
 * scroll lock, the pointer-events guard on the page behind — comes from Radix and is
 * therefore identical to every other dialog in the app. Duplicating that in a parallel
 * component is how one of the two copies ends up missing a piece.
 *
 * What is genuinely different is the geometry and the motion: full height, and never the whole
 * width (a drawer that reaches the far edge reads as a page, not a layer), sliding in from the
 * docked edge over the 220ms `--ease-drawer` `docs/design.md` §5 gives panels and sheets
 * instead of the dialog's centred zoom.
 *
 * The slide is written as real keyframes in `globals.css`, keyed off the `data-slot` and
 * `data-state` attributes below, and not with `animate-in` / `slide-in-from-*` utility
 * classes: this project imports plain `tailwindcss` with no animation plugin, so those class
 * names generate nothing. (The ones already on `DialogContent` and `DialogOverlay` are
 * inert for the same reason — pre-existing, and not this component's to fix.) Writing the
 * keyframes out is also what lets `prefers-reduced-motion` drop the movement and keep the
 * fade, which §5 asks for and a utility class could not express.
 *
 * No close button of its own: the drawer's close control is a real, labelled `DialogClose`
 * placed by the caller, where it can sit in the drawer's own header row rather than floating
 * over its first item.
 */
function DialogDrawerContent({
  className,
  children,
  side = 'left',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-drawer-content"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-50 flex h-dvh w-[min(20rem,85vw)] flex-col bg-card shadow-overlay outline-none',
          side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'sticky top-0 flex flex-col gap-2 bg-background text-center sm:text-left',
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'sticky bottom-0 flex flex-col-reverse gap-2 bg-background sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t('close')}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogDrawerContent,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
