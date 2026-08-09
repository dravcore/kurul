'use client';

import { useTranslations } from 'next-intl';
import { AppSidebar } from './app-sidebar';
import { useWorkspaceContext, WorkspaceProvider } from './workspace-provider';

function AppShellFrame({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const t = useTranslations('app');
  const {
    sessionPending,
    hasSession,
    bootstrapped,
    loadError,
    retryBootstrap,
  } = useWorkspaceContext();

  if (sessionPending || !hasSession || !bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        {t('shell.loading')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={retryBootstrap}
          className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-sm text-[var(--color-primary-foreground)]"
        >
          {t('shell.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex-1 p-6">{children}</div>
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
