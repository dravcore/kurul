'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogDrawerContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SidebarBody } from './sidebar-body';

/**
 * Navigation below `md`: a hamburger in the topbar and the sidebar in an off-canvas drawer.
 *
 * This is the whole of FE-06's answer. Above 768px it renders nothing at all — `md:hidden` on
 * the trigger, and the drawer cannot be opened without it — so the desktop shell is untouched
 * by every line here.
 *
 * **Why a `Dialog` and not a positioned `<div>` with a backdrop.** Everything that makes an
 * off-canvas panel correct is the modal contract, not the sliding: focus moves in on open and
 * back to the hamburger on close, `Tab` cannot walk onto the board underneath, `Escape`
 * dismisses, the page behind is inert and `aria-hidden`, and the scroll position is locked so
 * the board is not quietly scrolled by a swipe meant for the drawer. Radix's Dialog is
 * already in this app and already does all of it; a second overlay mechanism would be a second
 * place for one of those to be missing. `DialogDrawerContent` (components/ui/dialog.tsx) is
 * the same portal, overlay and content, docked to an edge.
 *
 * **Why `open` is state here.** Radix would manage it, but the drawer has to close on a
 * navigation as well as on a dismissal, and App Router navigation does not necessarily unmount
 * the shell — so nothing about following a link reliably puts the layer away on its own.
 * `SidebarBody` gets `onNavigate`, and the pathname reconciliation below is the belt to that
 * braces: a link followed from *inside* the drawer that is not one of the two nav rows (the
 * workspace switcher's "New workspace", the confirm-email row) closes it too, without every
 * one of them having to remember to.
 *
 * That reconciliation runs **during render**, not from an effect. Same reasoning — and the
 * same shape — as `board-filter-search.tsx`: the drawer would otherwise paint one frame over
 * the page it has just navigated to and then close, which is the frame the reader is looking
 * at. An effect here is also what `react-hooks/set-state-in-effect` exists to reject.
 */
export function MobileNav(): React.ReactElement {
  const t = useTranslations('app.shell');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [syncedPathname, setSyncedPathname] = useState(pathname);

  if (syncedPathname !== pathname) {
    setSyncedPathname(pathname);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t('openNavigation')}
        >
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogDrawerContent side="left">
        {/* Radix requires a title on every dialog and warns in development without one. It is
            `sr-only` rather than absent because the drawer's own visible heading is the app
            name in `SidebarBody`'s header row, which names the product, not this layer. */}
        <DialogTitle className="sr-only">{t('navigation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('navigationDescription')}</DialogDescription>
        <SidebarBody
          collapsed={false}
          touchTargets
          onNavigate={() => setOpen(false)}
          headerAction={
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('closeNavigation')}
              >
                <X />
              </Button>
            </DialogClose>
          }
        />
      </DialogDrawerContent>
    </Dialog>
  );
}
