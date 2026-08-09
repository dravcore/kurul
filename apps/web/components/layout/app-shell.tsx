'use client';

import { useTranslations } from 'next-intl';
import { AppSidebar } from './app-sidebar';
import { useWorkspaceContext, WorkspaceProvider } from './workspace-provider';
import { Button } from '@/components/ui/button';

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
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t('shell.loading')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button type="button" onClick={retryBootstrap}>
          {t('shell.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
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
