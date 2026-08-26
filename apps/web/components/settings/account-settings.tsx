'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { UserDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Row height matches the list/table row in docs/design.md §4, same as `WorkspaceSettings`. */
const ROW = 'flex min-h-9 items-center justify-between gap-3 py-1.5';

/**
 * The account itself, as opposed to the workspace it is currently looking at.
 *
 * One control, and the only one on this screen whose consequences reach past this tenant: it
 * removes the person from every workspace they are in, on every instance-local surface at once
 * (`docs/decisions/0026-account-deletion-anonymisation.md`).
 *
 * The address is read from `/me` rather than from the session, for the same reason
 * `LanguageSettings` reads it from there: Better Auth caches the session user in a cookie for
 * 60 seconds, and a stale one would show a row for an address this account no longer has.
 *
 * The delete control is a link out to `/settings/account/delete` rather than a dialog it opens
 * in place: that route reads `/me` again for the same address, and re-fetching it there is what
 * keeps this section from having to hold state a screen away from where it is used.
 */
export function AccountSettings(): React.ReactElement {
  const t = useTranslations('app.settings.account');
  const tShell = useTranslations('app.shell');

  const fetchMe = useCallback((signal: AbortSignal) => api.get<UserDto>('/me', { signal }), []);
  const {
    data: user,
    loading,
    error,
  } = useApiResource<UserDto | null>(fetchMe, null, t('loadError'));

  if (loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy>
        <span className="sr-only">{tShell('loading')}</span>
        <Skeleton className="h-9 w-full rounded-[var(--radius-md)]" />
      </div>
    );
  }

  // No user means the one read this section needs failed. The delete button is not drawn at
  // all in that state: it would open a dialog that cannot confirm anything, because the
  // address it compares against is exactly what did not load.
  if (!user) {
    return <p className="text-body text-destructive">{error ?? t('loadError')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={ROW}>
        <p className="min-w-0 truncate text-body text-foreground">{user.email}</p>
      </div>

      <div className={ROW}>
        <div className="min-w-0">
          <p className="text-body text-foreground">{t('deleteSectionTitle')}</p>
          <p className="text-small text-muted-foreground">{t('deleteSectionBody')}</p>
        </div>
        <Button asChild variant="destructive" size="sm">
          <Link href="/settings/account/delete">{t('deleteAction')}</Link>
        </Button>
      </div>
    </div>
  );
}
