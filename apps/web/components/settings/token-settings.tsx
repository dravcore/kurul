'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CreatedPersonalAccessTokenDto, PersonalAccessTokenDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateTokenDialog } from './create-token-dialog';
import { RevokeTokenDialog } from './revoke-token-dialog';
import { TokenCreatedDialog } from './token-created-dialog';

/** Row height matches the list/table row in docs/design.md §4, same as `MembersSettings`. */
const ROW = 'flex min-h-9 items-center justify-between gap-3 py-1.5';

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/**
 * A member's own personal access tokens: create one, see the ones that already exist, revoke
 * one that is no longer needed.
 *
 * Scoped to the caller by the endpoint itself (`GET .../tokens` answers only the requester's
 * own live tokens, see `PersonalAccessTokenDto` in `@kurul/shared-types`), so this component
 * carries no role check of its own, unlike `MembersSettings`: there is no version of this
 * screen anyone sees a management control on someone else's token.
 */
export function TokenSettings(): React.ReactElement {
  const t = useTranslations('app.settings.tokens');
  const tShell = useTranslations('app.shell');
  const tErrors = useTranslations('app.errors');
  const locale = useLocale();
  const { activeId } = useWorkspaceContext();

  const [createOpen, setCreateOpen] = useState(false);
  // The plaintext of a token that was just created, on its way to `TokenCreatedDialog`. Held
  // here rather than inside that dialog because the row it becomes is appended only once the
  // dialog closes: see that component's own comment for why.
  const [created, setCreated] = useState<CreatedPersonalAccessTokenDto | null>(null);
  const [revokeToken, setRevokeToken] = useState<PersonalAccessTokenDto | null>(null);

  const load = useMemo(
    () =>
      activeId
        ? (signal: AbortSignal) =>
            api.get<PersonalAccessTokenDto[]>(`/workspaces/${activeId}/tokens`, { signal })
        : null,
    [activeId],
  );

  const {
    data: tokens,
    loading,
    error,
    reload,
    setData: setTokens,
  } = useApiResource<PersonalAccessTokenDto[]>(load, [], t('loadError'));

  // Same reasoning as `MembersSettings`: no active workspace is the shell still resolving, not
  // a request that failed, so this waits rather than blaming a load nobody started.
  if (!activeId || loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy>
        <span className="sr-only">{tShell('loading')}</span>
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    // Nothing here explains itself, so the recovery is a control rather than a sentence
    // (docs/design.md §7).
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-destructive">{error}</p>
        <Button type="button" onClick={reload}>
          {tErrors('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-start">
        {/* outline, not the default primary: /settings has one primary button budget and
            "Invite member" (MembersSettings, the section above this one) already spends it
            (docs/design.md §2). */}
        <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
          {t('createAction')}
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {tokens.map((token) => (
            <li key={token.id} className={ROW}>
              <div className="min-w-0">
                <p className="truncate text-body text-foreground">{token.name}</p>
                {/* Each fact its own element, not one sentence built from four interpolations:
                    a reader scanning the row needs to pick out "never used" or an expiry at a
                    glance, the same reason `MembersSettings` keeps the "You" badge separate
                    from the member's name rather than folding it into one string. */}
                <p className="flex flex-wrap items-center gap-x-1.5 truncate text-small text-muted-foreground">
                  <span className="font-mono">{token.prefix}…</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('createdAt', { when: formatDate(token.createdAt, locale) })}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {token.lastUsedAt
                      ? t('lastUsedAt', { when: formatDate(token.lastUsedAt, locale) })
                      : t('lastUsedNever')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {token.expiresAt
                      ? t('expiresAt', { when: formatDate(token.expiresAt, locale) })
                      : t('expiresNever')}
                  </span>
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeToken(token)}>
                {t('revokeAction')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={activeId}
        onCreated={setCreated}
      />
      <TokenCreatedDialog
        open={created !== null}
        onOpenChange={(open) => {
          if (open) return;
          if (created) setTokens((current) => [created, ...current]);
          setCreated(null);
        }}
        token={created}
      />
      <RevokeTokenDialog
        open={revokeToken !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeToken(null);
        }}
        workspaceId={activeId}
        token={revokeToken}
        onRevoked={(tokenId) =>
          setTokens((current) => current.filter((item) => item.id !== tokenId))
        }
      />
    </div>
  );
}
