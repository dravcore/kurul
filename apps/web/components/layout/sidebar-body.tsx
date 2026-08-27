'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmailVerificationLink } from '@/components/auth/email-verification-link';
import { SancakRail, useSancakRail } from './sancak-rail';
import { NotificationBell } from '@/components/notification/notification-bell';
import { ThemeToggle } from './theme-toggle';
import { useWorkspaceContext } from './workspace-provider';
import { WorkspaceSwitcher } from './workspace-switcher';

interface SidebarBodyProps {
  /** The 56px icon rail. Only the desktop `<aside>` ever passes `true`. */
  collapsed: boolean;
  /**
   * The control in the top-right of the header row: the collapse toggle in the desktop
   * sidebar, the drawer's close button off-canvas. It is a slot rather than a `variant` prop
   * because the two are not variations on one control — one changes a width, the other
   * dismisses a layer — and a boolean that picked between them would be a lie about that.
   */
  headerAction: React.ReactNode;
  /**
   * Size the rows for a thumb: 44px minimum instead of the desktop 36px.
   *
   * A prop and not a `max-md:` class, because the condition is *which box this is in*, not
   * how wide the window is. The drawer only ever exists below `md`, so the two happen to
   * coincide today — but a viewport-keyed class on a shared component would also raise the
   * desktop `<aside>`'s rows the moment someone resized a laptop window under 768px, which is
   * a change to a layout that is not the mobile one and is not what `docs/design.md` §4 says
   * a sidebar row is.
   */
  touchTargets?: boolean;
  /**
   * Called when the reader follows a link out of here. The drawer uses it to close itself;
   * the desktop sidebar has nothing to close and leaves it undefined.
   *
   * The drawer has to be told, rather than closing itself on a route change: App Router
   * navigation does not unmount the shell, so nothing else about following a link would put
   * the layer away — and a drawer still sitting over the page it just navigated to is the
   * single most common way this pattern is shipped broken.
   */
  onNavigate?: () => void;
}

/**
 * Everything inside the sidebar, independent of the box it is drawn in.
 *
 * Two boxes exist: the `<aside>` that is part of the desktop layout, and the off-canvas
 * `Dialog` drawer below `md`. They render the same component so that a nav item added to one
 * is an item in both — the alternative, two lists that happen to agree today, is how a mobile
 * navigation ends up missing the link that was added last quarter.
 */
export function SidebarBody({
  collapsed,
  headerAction,
  touchTargets = false,
  onNavigate,
}: Readonly<SidebarBodyProps>): React.ReactElement {
  const t = useTranslations('app');
  const pathname = usePathname();
  const { onSignOut } = useWorkspaceContext();
  const navRef = useRef<HTMLElement | null>(null);
  const railBox = useSancakRail(navRef, [pathname, collapsed]);

  const dashboardActive = pathname.startsWith('/dashboard');
  const settingsActive = pathname.startsWith('/settings');

  const navLinkClass = (active: boolean): string =>
    cn(
      'relative flex items-center gap-2 rounded-md px-2 py-2 text-body transition-[color,background-color,border-color]',
      touchTargets && 'min-h-11',
      active
        ? 'bg-signature-subtle font-strong text-foreground'
        : 'text-foreground-secondary hover:bg-muted',
      collapsed && 'justify-center px-0',
    );

  return (
    <>
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
          {headerAction}
        </div>
      </div>

      <div className={cn('mb-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <Separator />

      <nav ref={navRef} className="relative flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        <SancakRail box={railBox} />
        <Link
          href="/dashboard"
          data-rail-active={dashboardActive || undefined}
          aria-current={dashboardActive ? 'page' : undefined}
          className={navLinkClass(dashboardActive)}
          title={t('dashboard.title')}
          onClick={onNavigate}
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
          onClick={onNavigate}
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
          className={cn(
            'w-full justify-start gap-2',
            touchTargets && 'min-h-11',
            collapsed && 'justify-center px-0',
          )}
          onClick={() => void onSignOut()}
        >
          <LogOut className="size-5" />
          {!collapsed ? t('shell.signOut') : null}
        </Button>
      </div>
    </>
  );
}
