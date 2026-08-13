'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  MemberRole,
  type CreateInvitationRequest,
  type InvitationDto,
} from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { INVITABLE_ROLES } from '@/lib/member-permissions';
import { FormDialog } from '@/components/common/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The created (or re-issued) invitation, so the pending list updates without a refetch. */
  onInvited: (invitation: InvitationDto) => void;
}

/**
 * Send an invitation, from the settings screen.
 *
 * The role defaults to MEMBER rather than to the least privileged option: an invitation is
 * almost always someone joining the work, and a GUEST default would quietly ship read-only
 * teammates to anyone who did not read the picker.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  onInvited,
}: InviteMemberDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>(MemberRole.MEMBER);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(): Promise<void> {
    const body: CreateInvitationRequest = { email: email.trim(), role };
    const invitation = await api.post<InvitationDto, CreateInvitationRequest>(
      `/workspaces/${workspaceId}/invitations`,
      body,
    );
    onInvited(invitation);

    // The invitation lands in a list the admin can already see, so the row *is* the
    // confirmation — but the thing that actually happened is off-screen, in someone else's
    // inbox, and only a message can report that (docs/design.md §7).
    toast.success(t('inviteSent', { email: invitation.email }));

    // This dialog is not unmounted when it closes, only its body is, so the address has to be
    // cleared here or the next invitation opens pre-filled with the previous person's email.
    // The role is deliberately kept: inviting three admins in a row is a real thing to do.
    setEmail('');
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('inviteTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('inviteSubmit')}
      submitDisabled={email.trim().length === 0}
      initialFocusRef={emailRef}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'inviteError',
          byStatus: {
            // 400 covers both a malformed address and Better Auth's deliberately generic
            // "cannot invite this address" — the server refuses to say which, so that the
            // endpoint cannot be used to find out who already has an account.
            400: 'inviteErrorAddress',
            403: 'inviteErrorForbidden',
            409: 'inviteErrorConflict',
            429: 'inviteErrorTooMany',
          },
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-member-email">{t('inviteEmail')}</Label>
        <Input
          id="invite-member-email"
          ref={emailRef}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-member-role">{t('inviteRole')}</Label>
        <Select
          id="invite-member-role"
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          {INVITABLE_ROLES.map((option) => (
            <option key={option} value={option}>
              {t(`roles.${option}`)}
            </option>
          ))}
        </Select>
        <p className="text-caption text-muted-foreground">{t(`roleHints.${role}`)}</p>
      </div>
    </FormDialog>
  );
}
