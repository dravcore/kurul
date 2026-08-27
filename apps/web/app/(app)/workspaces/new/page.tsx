'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { CreateWorkspaceRequest, WorkspaceDto } from '@kurul/shared-types';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { Button } from '@/components/ui/button';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * This route's own header, not `Topbar`. `Topbar` renders `MobileNav`, which is `SidebarBody`,
 * and every link there requires a workspace: a reader is on this page precisely because they
 * have none, so that navigation would just redirect back here
 * (`workspace-provider.tsx`'s bootstrap effect) under a different name. `AppShell` drops the
 * desktop sidebar for the same reason while the roster is empty, which is what leaves this the
 * only chrome on screen at every width rather than a second wordmark beside the sidebar's.
 * `onSignOut` is read from the same context `SidebarBody`'s sign-out button calls, so the
 * sign-out sequence itself stays defined once, in `WorkspaceProvider`.
 */
function NewWorkspaceHeader(): React.ReactElement {
  const t = useTranslations('app.shell');
  const { onSignOut } = useWorkspaceContext();

  return (
    <header className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between border-b border-border px-3">
      <p className="font-display text-title tracking-tight text-foreground">{t('title')}</p>
      <Button type="button" variant="ghost" onClick={() => void onSignOut()}>
        <LogOut className="size-5" />
        {t('signOut')}
      </Button>
    </header>
  );
}

export default function NewWorkspacePage(): React.ReactElement {
  const t = useTranslations('app.workspace');
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const body: CreateWorkspaceRequest = { name, slug };
      const workspace = await api.post<WorkspaceDto, CreateWorkspaceRequest>('/workspaces', body);
      await authClient.organization.setActive({
        organizationId: workspace.id,
      });

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <NewWorkspaceHeader />
      {/* The shell main has no scroller of its own (`docs/design.md` §4): every route under
          `(app)` declares one, same as dashboard, settings and notifications. */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <h1 className="text-title-lg tracking-tight">{t('createTitle')}</h1>
          <p className="text-body text-muted-foreground">{t('createSubtitle')}</p>

          <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
            <AuthFormField
              label={t('name')}
              value={name}
              onChange={(e) => {
                const next = e.target.value;
                setName(next);
                if (!slugTouched) {
                  setSlug(slugify(next));
                }
              }}
            />
            <AuthFormField
              label={t('slug')}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
            {error ? <p className="text-body text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {t('submit')}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
