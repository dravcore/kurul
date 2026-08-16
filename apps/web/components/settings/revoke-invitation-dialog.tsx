'use client';

import { useTranslations } from 'next-intl';
import type { InvitationDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface RevokeInvitationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  invitation: InvitationDto | null;
  onRevoked: (invitationId: string) => void;
}

export function RevokeInvitationDialog({
  open,
  onOpenChange,
  workspaceId,
  invitation,
  onRevoked,
}: RevokeInvitationDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.members');

  async function onConfirm(): Promise<void> {
    if (!invitation) return;
    await api.delete(`/workspaces/${workspaceId}/invitations/${invitation.id}`);
    onRevoked(invitation.id);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('revokeTitle')}
      description={t('revokeBody', { email: invitation?.email ?? '' })}
      cancelLabel={t('cancel')}
      confirmLabel={t('revokeAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'revokeError',
          byStatus: {
            403: 'revokeErrorForbidden',
            // Someone else revoked it, or the invitee accepted it, while this dialog was open.
            // Either way the row is stale rather than the request broken.
            404: 'revokeErrorGone',
          },
        })
      }
    />
  );
}
