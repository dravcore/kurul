'use client';

import { useTranslations } from 'next-intl';
import { AppSidebar } from './app-sidebar';
import { useWorkspaceContext, WorkspaceProvider } from './workspace-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function AppShellFrame({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const t = useTranslations('app');
  const { sessionPending, hasSession, bootstrapped, loadError, retryBootstrap } =
    useWorkspaceContext();

  if (sessionPending || !hasSession || !bootstrapped) {
    return (
      <div className="flex min-h-screen bg-background" aria-busy>
        <p className="sr-only">{t('shell.loading')}</p>
        <div className="hidden w-[var(--sidebar-width)] shrink-0 flex-col gap-2 border-r border-border bg-card p-3 lg:flex">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-4 h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-body text-destructive">{loadError}</p>
        <Button type="button" onClick={retryBootstrap}>
          {t('shell.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      {/* Skip-link target (see app/(app)/layout.tsx): tabIndex={-1} lets the fragment
          navigation move keyboard focus here without adding a tab stop. */}
      <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        {children}
      </main>
    </div>
  );
}

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <WorkspaceProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </WorkspaceProvider>
  );
}
