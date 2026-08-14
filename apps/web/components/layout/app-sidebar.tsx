'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LogOut, PanelLeftClose, PanelLeft, Settings } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmailVerificationLink } from '@/components/auth/email-verification-link';
import { SancakRail, useSancakRail } from './sancak-rail';
import { NotificationBell } from '@/components/notification/notification-bell';
import { ThemeToggle } from './theme-toggle';
import { useWorkspaceContext } from './workspace-provider';
import { WorkspaceSwitcher } from './workspace-switcher';

const COLLAPSE_MQ = '(max-width: 1279px)';
const COLLAPSE_STORAGE_KEY = 'kurultay:sidebar-collapsed';

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

export function AppSidebar(): React.ReactElement {
  const t = useTranslations('app');
  const pathname = usePathname();
  const { onSignOut } = useWorkspaceContext();
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const railBox = useSancakRail(navRef, [pathname, collapsed]);

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

  const dashboardActive = pathname.startsWith('/dashboard');
  const settingsActive = pathname.startsWith('/settings');

  const navLinkClass = (active: boolean): string =>
    cn(
      'relative flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-body transition-colors',
      active
        ? 'bg-signature-subtle font-strong text-foreground'
        : 'text-foreground-secondary hover:bg-muted',
      collapsed && 'justify-center px-0',
    );

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150 ease-[var(--ease-out)]',
        collapsed ? 'w-[var(--sidebar-rail-width)]' : 'w-[var(--sidebar-width)]',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3',
          collapsed ? 'h-12 justify-center' : 'h-12 justify-between',
        )}
      >
        {!collapsed ? (
          <p className="font-display text-title font-semibold tracking-tight text-foreground">
            {t('shell.title')}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          <NotificationBell />
          {!collapsed ? <ThemeToggle /> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
          </Button>
        </div>
      </div>

      <div className={cn('mb-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <Separator />

      <nav ref={navRef} className="relative flex flex-1 flex-col gap-1 p-2">
        <SancakRail box={railBox} />
        <Link
          href="/dashboard"
          data-rail-active={dashboardActive || undefined}
          aria-current={dashboardActive ? 'page' : undefined}
          className={navLinkClass(dashboardActive)}
          title={t('dashboard.title')}
        >
          <LayoutDashboard className="size-5 shrink-0" />
          {!collapsed ? <span>{t('dashboard.title')}</span> : null}
        </Link>
        <Link
          href="/settings"
          data-rail-active={settingsActive || undefined}
          aria-current={settingsActive ? 'page' : undefined}
          className={navLinkClass(settingsActive)}
          title={t('shell.settings')}
        >
          <Settings className="size-5 shrink-0" />
          {!collapsed ? <span>{t('shell.settings')}</span> : null}
        </Link>
      </nav>

      <div className="border-t border-border p-2">
        {collapsed ? <div className="mb-2 flex justify-center">{<ThemeToggle />}</div> : null}
        {/* Renders itself away for a confirmed address — see EmailVerificationLink. */}
        <EmailVerificationLink collapsed={collapsed} />
        <Button
          type="button"
          variant="ghost"
          className={cn('w-full justify-start gap-2', collapsed && 'justify-center px-0')}
          onClick={() => void onSignOut()}
        >
          <LogOut className="size-4" />
          {!collapsed ? t('shell.signOut') : null}
        </Button>
      </div>
    </aside>
  );
}
