'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

export function AppSidebar(): React.ReactElement {
  const t = useTranslations('app');
  const pathname = usePathname();
  const { onSignOut } = useWorkspaceContext();
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const railBox = useSancakRail(navRef, [pathname, collapsed]);

  useEffect(() => {
    const media = window.matchMedia(COLLAPSE_MQ);
    const sync = (): void => setCollapsed(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const dashboardActive = pathname.startsWith('/dashboard');

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
            onClick={() => setCollapsed((value) => !value)}
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
          className={cn(
            'relative flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-body transition-colors',
            dashboardActive
              ? 'bg-signature-subtle font-strong text-foreground'
              : 'text-foreground-secondary hover:bg-muted',
            collapsed && 'justify-center px-0',
          )}
          title={t('dashboard.title')}
        >
          <LayoutDashboard className="size-5 shrink-0" />
          {!collapsed ? <span>{t('dashboard.title')}</span> : null}
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
