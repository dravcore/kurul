'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useWorkspaceContext } from './workspace-provider';

export function AppSidebar(): React.ReactElement {
  const t = useTranslations('app');
  const { workspaces, activeId, onSwitch, onSignOut } = useWorkspaceContext();

  return (
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
  );
}
