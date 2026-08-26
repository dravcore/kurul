'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  AccountDeletionPreviewDto,
  DeleteAccountRequest,
  UserDto,
  WorkspaceDispositionRequest,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { disconnectSocket } from '@/lib/socket';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/** The sentinel for "no decision yet" — never sent to the API. */
const UNDECIDED = '';
/** The option value that means "delete this workspace with everything in it". */
const DELETE_WORKSPACE = 'delete';

const EMPTY_PREVIEW: AccountDeletionPreviewDto = {
  userId: '',
  soleOwnedWorkspaces: [],
  otherWorkspaces: [],
  retainedContent: { comments: 0, tasksCreated: 0, attachments: 0, activities: 0 },
};

/**
 * Deleting the account — the one control in this product that nothing can undo, including a
 * restore the person themselves can ask for. `/settings/account/delete` rather than a dialog:
 * a sole-owned workspace needs one `<select>` of its own (transfer or destroy), and a caller
 * who owns several no longer fits a 512px surface at all (Phase 7 Task 5).
 *
 * The API refuses the deletion until every workspace the caller is the only OWNER of has an
 * explicit disposition (`docs/decisions/0026-account-deletion-anonymisation.md`), and the only
 * honest way to ask for one is to show the person what they own: how many people are in it, how
 * many boards, and who could take it over. So the preview is fetched on mount and the confirm
 * button stays disabled until every one of those questions has an answer.
 *
 * The two decisions are deliberately in **one `<select>` per workspace** rather than a radio
 * pair plus a person picker. "Hand it to Ada" and "destroy it" are alternatives to each other,
 * not a choice followed by a detail, and putting them in one list is what makes "delete" read
 * as one option among the people rather than as the default that happens when nothing is picked.
 *
 * `DeleteWorkspaceDialog`'s type-the-name gate is reused in spirit, not in shape: the thing
 * typed here is the account's own e-mail address, which is what the API checks. The address
 * itself is read from `/me` rather than passed in, for the same reason `LanguageSettings` reads
 * it from there: Better Auth caches the session user in a cookie for 60 seconds, and a stale
 * address would produce a refusal nobody could explain.
 */
export function DeleteAccountSettings(): React.ReactElement {
  const t = useTranslations('app.settings.account');
  const tShell = useTranslations('app.shell');
  const router = useRouter();

  const fetchMe = useCallback((signal: AbortSignal) => api.get<UserDto>('/me', { signal }), []);
  const me = useApiResource<UserDto | null>(fetchMe, null, t('loadError'));

  const fetchPreview = useCallback(
    (signal: AbortSignal) => api.get<AccountDeletionPreviewDto>('/me/deletion-preview', { signal }),
    [],
  );
  const preview = useApiResource(fetchPreview, EMPTY_PREVIEW, t('loadError'));

  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [typedEmail, setTypedEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = me.loading || preview.loading;
  const failed = me.failed || preview.failed;
  const email = me.data?.email ?? '';

  const soleOwned = preview.data.soleOwnedWorkspaces;
  const allDecided = soleOwned.every(
    (workspace) => (decisions[workspace.workspaceId] ?? UNDECIDED) !== UNDECIDED,
  );
  const confirmed = typedEmail.trim().toLowerCase() === email.trim().toLowerCase();
  const ready = !loading && !failed && allDecided && confirmed;

  function decide(workspaceId: string, value: string): void {
    setDecisions((current) => ({ ...current, [workspaceId]: value }));
  }

  function dispositionsFor(): WorkspaceDispositionRequest[] {
    return soleOwned.map((workspace) => {
      const choice = decisions[workspace.workspaceId];
      return choice === DELETE_WORKSPACE
        ? { workspaceId: workspace.workspaceId, action: 'delete' }
        : {
            workspaceId: workspace.workspaceId,
            action: 'transfer',
            // `ready` gates the submit on every workspace having a choice, so this is never
            // the sentinel by the time it is read.
            newOwnerUserId: choice ?? '',
          };
    });
  }

  async function onConfirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.delete<void>('/me', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmEmail: email,
          dispositions: dispositionsFor(),
        } satisfies DeleteAccountRequest),
      });

      // The API cleared the session cookies on the way out, so there is nothing to sign out
      // of — but the socket is still connected and still authenticated as a session the server
      // has torn down, exactly as after leaving a workspace.
      disconnectSocket();

      // No toast. Every other destructive action lands the user somewhere that does not explain
      // itself; this one lands them on the sign-in page having just been told, at length, what
      // was about to happen. A success message on top of that reads as a system notice about
      // somebody else.
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      setError(
        resolveApiMessage(caught, t, {
          fallback: 'deleteError',
          byStatus: {
            403: 'deleteErrorConfirm',
            404: 'deleteErrorTransferGone',
            409: 'deleteErrorUndecided',
          },
        }),
      );
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold">{t('deleteTitle')}</h2>
        <p className="text-body text-muted-foreground">{t('deleteBody')}</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" role="status" aria-busy>
          <span className="sr-only">{tShell('loading')}</span>
          <Skeleton className="h-9 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : null}

      {failed ? <p className="text-body text-destructive">{me.error ?? preview.error}</p> : null}

      {!loading && !failed ? (
        <div className="flex flex-col gap-4">
          <p className="text-small text-muted-foreground">
            {t('retained', {
              comments: preview.data.retainedContent.comments,
              tasks: preview.data.retainedContent.tasksCreated,
            })}
          </p>

          {soleOwned.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-body text-foreground">{t('ownedTitle')}</p>
              {soleOwned.map((workspace) => (
                <div key={workspace.workspaceId} className="flex flex-col gap-1.5">
                  <Label htmlFor={`disposition-${workspace.workspaceId}`}>
                    {t('ownedWorkspace', {
                      name: workspace.name,
                      members: workspace.memberCount,
                      boards: workspace.boardCount,
                    })}
                  </Label>
                  <Select
                    id={`disposition-${workspace.workspaceId}`}
                    value={decisions[workspace.workspaceId] ?? UNDECIDED}
                    onChange={(event) => decide(workspace.workspaceId, event.target.value)}
                  >
                    <option value={UNDECIDED}>{t('ownedChoose')}</option>
                    {workspace.transferCandidates.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId}>
                        {t('ownedTransferTo', { name: candidate.name })}
                      </option>
                    ))}
                    <option value={DELETE_WORKSPACE}>{t('ownedDelete')}</option>
                  </Select>
                  {workspace.transferCandidates.length === 0 ? (
                    // Said in the UI rather than discovered from a 404: there is nobody in
                    // this workspace to hand it to, so the only disposition the API accepts
                    // for it is deletion.
                    <p className="text-small text-muted-foreground">{t('ownedNobodyLeft')}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-account-confirm">{t('confirmLabel', { email })}</Label>
            <Input
              id="delete-account-confirm"
              value={typedEmail}
              onChange={(event) => setTypedEmail(event.target.value)}
              autoComplete="off"
              aria-invalid={typedEmail.length > 0 && !confirmed}
            />
          </div>
        </div>
      ) : null}

      {error ? <SubmitError message={error} /> : null}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost">
          <Link href="/settings">{t('cancel')}</Link>
        </Button>
        <Button
          type="button"
          variant="destructive"
          loading={pending}
          disabled={!ready}
          onClick={() => void onConfirm()}
        >
          {t('deleteAction')}
        </Button>
      </div>
    </div>
  );
}
