'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { WorkspaceDto } from '@kurultay/shared-types';
import { apiFetch } from '@/lib/api';
import { authClient } from '@/lib/auth';

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const t = useTranslations('app');
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (isPending) {
      return;
    }
    if (!session) {
      router.replace('/login');
      return;
    }

    void (async () => {
      const response = await apiFetch('/workspaces');
      if (!response.ok) {
        return;
      }
      const list = (await response.json()) as WorkspaceDto[];
      setWorkspaces(list);

      if (list.length === 0 && pathname !== '/workspaces/new') {
        router.replace('/workspaces/new');
        return;
      }

      const activeOrgId = session.session.activeOrganizationId ?? list[0]?.id ?? '';
      setActiveId(activeOrgId);
      if (activeOrgId && activeOrgId !== session.session.activeOrganizationId) {
        await authClient.organization.setActive({ organizationId: activeOrgId });
      }
    })();
  }, [session, isPending, router, pathname]);

  async function onSwitch(workspaceId: string): Promise<void> {
    setActiveId(workspaceId);
    await authClient.organization.setActive({ organizationId: workspaceId });
    router.refresh();
  }

  async function onSignOut(): Promise<void> {
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        {t('shell.loading')}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="mb-6 text-sm font-semibold">{t('shell.title')}</p>

        <label className="mb-4 flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
          <span>{t('shell.workspaces')}</span>
          <select
            value={activeId}
            onChange={(e) => void onSwitch(e.target.value)}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>

        <nav className="flex flex-1 flex-col gap-2 text-sm">
          <Link href="/dashboard">{t('dashboard.title')}</Link>
          <Link href="/workspaces/new">{t('shell.createWorkspace')}</Link>
        </nav>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="mt-4 text-left text-sm text-[var(--color-muted-foreground)] underline"
        >
          {t('shell.signOut')}
        </button>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
