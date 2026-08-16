'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { InvitationDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { authClient } from '@/lib/auth';
import { fetchInstanceConfig } from '@/lib/instance-config';
import { canManageMember, canManageMembers } from '@/lib/member-permissions';
import { fetchAllWorkspaceMembers, fetchPendingInvitations } from '@/lib/member-query';
import { formatRelativeTime } from '@/lib/relative-time';
import { useApiResource, useResourceField } from '@/lib/use-api-resource';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ChangeMemberRoleDialog } from './change-member-role-dialog';
import { InviteMemberDialog } from './invite-member-dialog';
import { LeaveWorkspaceDialog } from './leave-workspace-dialog';
import { MailDisabledNotice } from './mail-disabled-notice';
import { RemoveMemberDialog } from './remove-member-dialog';
import { RevokeInvitationDialog } from './revoke-invitation-dialog';

/**
 * The roster, the invitation queue, and whether invitations can be delivered at all — loaded
 * as one value.
 *
 * They are one `useApiResource` because they are one question — "who is in this workspace, who
 * is on the way in, and can we even reach them" — and because only some of them are readable
 * by every caller. Split into separate resources, a MEMBER would see a working roster next to
 * a failed invitation load that is not a failure at all, and the screen would need a second
 * error surface to say so.
 */
interface MemberRoster {
  members: WorkspaceMemberDto[];
  /** Always empty for a caller who may not read it; the request is not even sent. */
  invitations: InvitationDto[];
  /**
   * `InstanceConfigDto.mailEnabled` — whether the API has a transport that can deliver an
   * invitation email. Only fetched for someone who can invite, because it only decides whether
   * to warn them.
   */
  mailEnabled: boolean;
}

/**
 * `mailEnabled: true` before anything has loaded, so the warning appears only once the server
 * has said it is warranted. Defaulting to `false` would flash "email isn't configured" on
 * every load of a perfectly configured deployment, which teaches admins to ignore it.
 */
const EMPTY_ROSTER: MemberRoster = { members: [], invitations: [], mailEnabled: true };

/** Row height matches the list/table row in docs/design.md §4. */
const ROW = 'flex min-h-9 items-center justify-between gap-3 py-1.5';

export function MembersSettings(): React.ReactElement {
  const t = useTranslations('app.settings.members');
  const tShell = useTranslations('app.shell');
  const tErrors = useTranslations('app.errors');
  const locale = useLocale();
  const { activeId, activeRole } = useWorkspaceContext();
  const { data: session } = authClient.useSession();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [revokeInvitation, setRevokeInvitation] = useState<InvitationDto | null>(null);
  const [roleMember, setRoleMember] = useState<WorkspaceMemberDto | null>(null);
  const [removeMember, setRemoveMember] = useState<WorkspaceMemberDto | null>(null);

  const currentUserId = session?.user.id ?? '';
  const canManage = canManageMembers(activeRole);

  const load = useMemo(() => {
    if (!activeId) return null;
    return async (signal: AbortSignal): Promise<MemberRoster> => {
      const members = await fetchAllWorkspaceMembers(activeId, { signal });
      // Not a permission the UI is *choosing* to skip — `GET .../invitations` answers 403 to
      // anyone below ADMIN, so asking would turn a screen that works into one that failed.
      const invitations = canManage ? await fetchPendingInvitations(activeId, { signal }) : [];
      // Skipped for the same shape of reason, one step softer: `GET /config` would answer
      // anyone signed in, but a member who cannot invite has no use for the answer, and an
      // instance-wide warning on a screen with no invite control would only puzzle them.
      const { mailEnabled } = canManage
        ? await fetchInstanceConfig({ signal })
        : { mailEnabled: true };

      return { members, invitations, mailEnabled };
    };
  }, [activeId, canManage]);

  const {
    data: roster,
    loading,
    error,
    reload,
    setData,
  } = useApiResource<MemberRoster>(load, EMPTY_ROSTER, t('loadError'));

  const setMembers = useResourceField(setData, 'members');
  const setInvitations = useResourceField(setData, 'invitations');

  // Same reasoning as `BoardList`: no active workspace is a state the shell is still resolving,
  // not a request that failed, so it waits rather than blaming a load nobody started.
  if (!activeId || loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy>
        <span className="sr-only">{tShell('loading')}</span>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-[var(--radius-md)]" />
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

  async function onCopyLink(invitation: InvitationDto): Promise<void> {
    // The accept link is the whole invitation when outbound mail is not configured yet, which
    // is the state a fresh self-hosted install starts in. `clipboard` is absent over plain
    // HTTP and in older browsers, and a button that silently does nothing is worse than one
    // that says why.
    try {
      await navigator.clipboard.writeText(invitation.acceptUrl);
      toast.success(t('copiedLink'));
    } catch {
      toast.error(t('copyLinkError'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Above the invite control rather than inside the dialog: it is a standing property of
          the deployment, not a warning about the address being typed, and someone reading the
          pending queue needs it just as much as someone about to add to it. */}
      {canManage && !roster.mailEnabled ? <MailDisabledNotice /> : null}

      {canManage ? (
        <div className="flex justify-start">
          <Button type="button" onClick={() => setInviteOpen(true)}>
            {t('inviteAction')}
          </Button>
        </div>
      ) : null}

      {/* Hidden entirely when there is nothing waiting: an empty "Waiting to be accepted"
          heading is a section that only ever reports its own absence. */}
      {canManage && roster.invitations.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-small font-strong text-muted-foreground">{t('pendingTitle')}</h3>
          <ul className="divide-y divide-border">
            {roster.invitations.map((invitation) => (
              <li key={invitation.id} className={ROW}>
                <div className="min-w-0">
                  <p className="truncate text-body text-foreground">{invitation.email}</p>
                  <p className="text-caption text-muted-foreground">
                    {t('pendingExpires', {
                      when: formatRelativeTime(invitation.expiresAt, locale),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-small text-muted-foreground">
                    {t(`roles.${invitation.role}`)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void onCopyLink(invitation)}
                  >
                    {t('copyLink')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevokeInvitation(invitation)}
                  >
                    {t('revokeAction')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="divide-y divide-border">
        {roster.members.map((member) => {
          const isSelf = member.userId === currentUserId;
          // An ADMIN keeps every control on everyone except an OWNER, which is where the API
          // answers 403 — so the row simply carries no menu instead of a menu that refuses.
          const manageable = !isSelf && canManageMember(activeRole, member.role);

          return (
            <li key={member.id} className={ROW}>
              <p className="min-w-0 truncate text-body text-foreground">
                {member.name}
                {isSelf ? (
                  <span className="ml-2 text-caption text-muted-foreground">{t('you')}</span>
                ) : null}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-small text-muted-foreground">
                  {t(`roles.${member.role}`)}
                </span>
                {isSelf || manageable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('memberMenu', { name: member.name })}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {manageable ? (
                        <DropdownMenuItem onClick={() => setRoleMember(member)}>
                          {t('changeRoleAction')}
                        </DropdownMenuItem>
                      ) : null}
                      {manageable ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setRemoveMember(member)}
                        >
                          {t('removeAction')}
                        </DropdownMenuItem>
                      ) : null}
                      {isSelf ? (
                        <DropdownMenuItem variant="destructive" onClick={() => setLeaveOpen(true)}>
                          {t('leaveAction')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={activeId}
        onInvited={(invitation) =>
          // `POST /invitations` re-issues rather than duplicates when the address already has a
          // pending invitation, so the same id can come back — replace it instead of listing it
          // twice, and keep the queue in the id order the server pages in.
          setInvitations((current) => [
            ...current.filter((item) => item.id !== invitation.id),
            invitation,
          ])
        }
      />
      <RevokeInvitationDialog
        open={revokeInvitation !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeInvitation(null);
        }}
        workspaceId={activeId}
        invitation={revokeInvitation}
        onRevoked={(invitationId) =>
          setInvitations((current) => current.filter((item) => item.id !== invitationId))
        }
      />
      <ChangeMemberRoleDialog
        open={roleMember !== null}
        onOpenChange={(open) => {
          if (!open) setRoleMember(null);
        }}
        workspaceId={activeId}
        member={roleMember}
        actorRole={activeRole}
        onChanged={(updated) =>
          setMembers((current) =>
            current.map((item) => (item.userId === updated.userId ? updated : item)),
          )
        }
      />
      <RemoveMemberDialog
        open={removeMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveMember(null);
        }}
        workspaceId={activeId}
        member={removeMember}
        onRemoved={(userId) =>
          setMembers((current) => current.filter((item) => item.userId !== userId))
        }
      />
      <LeaveWorkspaceDialog open={leaveOpen} onOpenChange={setLeaveOpen} workspaceId={activeId} />
    </div>
  );
}
