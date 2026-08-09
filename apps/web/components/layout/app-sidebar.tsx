'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from './theme-toggle';
import { useWorkspaceContext } from './workspace-provider';

const COLLAPSE_MQ = '(max-width: 1279px)';

export function AppSidebar(): React.ReactElement {
  const t = useTranslations('app');
  const pathname = usePathname();
  const { workspaces, activeId, onSwitch, onSignOut } = useWorkspaceContext();
  const [collapsed, setCollapsed] = useState(false);

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
          <p className="font-display text-base font-semibold tracking-tight text-foreground">
            {t('shell.title')}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
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

      {!collapsed ? (
        <label className="mx-3 mb-3 flex flex-col gap-1 text-xs text-muted-foreground">
          <span>{t('shell.workspaces')}</span>
          <select
            value={activeId}
            onChange={(e) => void onSwitch(e.target.value)}
            className="h-9 rounded-[var(--radius-md)] border border-border bg-background px-2 text-sm text-foreground"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <Separator />

      <nav className="flex flex-1 flex-col gap-1 p-2">
        <Link
          href="/dashboard"
          className={cn(
            'relative flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-sm transition-colors',
            dashboardActive
              ? 'bg-signature-subtle font-medium text-foreground'
              : 'text-foreground-secondary hover:bg-muted',
            collapsed && 'justify-center px-0',
          )}
          title={t('dashboard.title')}
        >
          {dashboardActive ? (
            <span
              className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-signature"
              aria-hidden
            />
          ) : null}
          <LayoutDashboard className="size-5 shrink-0" />
          {!collapsed ? <span>{t('dashboard.title')}</span> : null}
        </Link>
        {!collapsed ? (
          <Link
            href="/workspaces/new"
            className="rounded-[var(--radius-md)] px-2 py-2 text-sm text-foreground-secondary hover:bg-muted"
          >
            {t('shell.createWorkspace')}
          </Link>
        ) : null}
      </nav>

      <div className="border-t border-border p-2">
        {collapsed ? <div className="mb-2 flex justify-center">{<ThemeToggle />}</div> : null}
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
