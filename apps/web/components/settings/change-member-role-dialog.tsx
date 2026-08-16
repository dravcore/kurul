'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MemberRole,
  type UpdateMemberRoleRequest,
  type WorkspaceMemberDto,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { assignableRoles } from '@/lib/member-permissions';
import { FormDialog } from '@/components/common/form-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface ChangeMemberRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  member: WorkspaceMemberDto | null;
  /** The signed-in user's role — it decides whether OWNER is on offer at all. */
  actorRole: MemberRole | null;
  onChanged: (member: WorkspaceMemberDto) => void;
}

export function ChangeMemberRoleDialog({
  open,
  onOpenChange,
  workspaceId,
  member,
  actorRole,
  onChanged,
}: ChangeMemberRoleDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.members');
  const [role, setRole] = useState<MemberRole>(member?.role ?? MemberRole.MEMBER);

  // Load the picker when a different member is handed over, during render rather than from an
  // effect — the same reason as `RenameBoardDialog`: an effect paints one frame showing the
  // *previous* member's role, which is visible every time the dialog is opened on a second row.
  //
  // `member` is null while the dialog animates out; blanking then would be a new flicker.
  const [syncedMember, setSyncedMember] = useState(member);
  if (member && member !== syncedMember) {
    setSyncedMember(member);
    setRole(member.role);
  }

  async function onSubmit(): Promise<void> {
    if (!member) return;
    const body: UpdateMemberRoleRequest = { role };
    const updated = await api.patch<WorkspaceMemberDto, UpdateMemberRoleRequest>(
      `/workspaces/${workspaceId}/members/${member.userId}/role`,
      body,
    );
    onChanged(updated);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('changeRoleTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('changeRoleSubmit')}
      // The API answers an unchanged role with a `200` and no write, so submitting it is
      // harmless — it is just a round trip that tells the user nothing.
      submitDisabled={member === null || role === member.role}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'changeRoleError',
          byStatus: {
            403: 'changeRoleErrorForbidden',
            404: 'changeRoleErrorGone',
            // The one refusal that names its own way out: the workspace has to keep an owner,
            // so the next move is to promote someone before demoting this one.
            409: 'changeRoleErrorLastOwner',
          },
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="change-member-role">{t('inviteRole')}</Label>
        <Select
          id="change-member-role"
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          {assignableRoles(actorRole).map((option) => (
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
