'use client';

import { useTranslations } from 'next-intl';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SidebarBody } from './sidebar-body';

const COLLAPSE_MQ = '(max-width: 1279px)';
const COLLAPSE_STORAGE_KEY = 'kurul:sidebar-collapsed';

/**
 * `localStorage` throws in private-browsing/quota-exceeded states and does not exist during
 * SSR at all, so every access is wrapped rather than trusted — a missing preference should
 * fall back to the breakpoint default, not crash the shell.
 */
function readStoredCollapsed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw === null ? null : raw === 'true';
  } catch {
    return null;
  }
}

function writeStoredCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(value));
  } catch {
    // Best-effort persistence — a full or blocked store just means the preference does not
    // survive reload, which is the pre-existing behavior this change is improving on, not a
    // new failure mode to surface.
  }
}

/**
 * The sidebar as part of the desktop layout.
 *
 * `hidden md:flex`, and that is the whole of the mobile story here: below 768px this element
 * does not exist, and `MobileNav` puts the same `SidebarBody` in an off-canvas drawer instead.
 * The rail was the thing FE-06 measured — a 56px column of icons that kept its width at 360px,
 * where it cost 15% of the viewport and still could not show a workspace name.
 *
 * `hidden` and not a `matchMedia` check: this component is rendered by a client shell but its
 * markup is also what the server sends, and a JS-side breakpoint would flash the sidebar on
 * every mobile page load before the first effect ran.
 */
export function AppSidebar(): React.ReactElement {
  const t = useTranslations('app');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(COLLAPSE_MQ);
    // A stored preference always wins over the breakpoint — re-read on every sync rather than
    // caching an "is overridden" flag, so a manual toggle (which writes storage immediately,
    // see `toggleCollapsed`) is picked up the next time this same function runs, whether that
    // is the call below or the next `change` event. One function serving both roles, invoked
    // directly once and then registered as the listener, mirrors the exact shape the media
    // sync used before this fix and is what keeps this the sidebar's single source of truth
    // for `collapsed` instead of splitting it across a ref and the effect body.
    const sync = (): void => {
      const stored = readStoredCollapsed();
      setCollapsed(stored ?? media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((value) => {
      const next = !value;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150 ease-out md:flex',
        collapsed ? 'w-[var(--sidebar-rail-width)]' : 'w-[var(--sidebar-width)]',
      )}
    >
      <SidebarBody
        collapsed={collapsed}
        headerAction={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
          </Button>
        }
      />
    </aside>
  );
}
