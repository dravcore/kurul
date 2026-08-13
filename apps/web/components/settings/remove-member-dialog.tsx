'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  member: WorkspaceMemberDto | null;
  onRemoved: (userId: string) => void;
}

/**
 * Revoke someone else's membership. Addressed by `userId`, which is what the endpoint takes —
 * the membership row id in `WorkspaceMemberDto.id` is an implementation detail of the roster.
 */
export function RemoveMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  member,
  onRemoved,
}: RemoveMemberDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.members');

  async function onConfirm(): Promise<void> {
    if (!member) return;
    await api.delete(`/workspaces/${workspaceId}/members/${member.userId}`);
    onRemoved(member.userId);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('removeTitle', { name: member?.name ?? '' })}
      description={t('removeBody')}
      cancelLabel={t('cancel')}
      confirmLabel={t('removeAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'removeError',
          byStatus: {
            403: 'removeErrorForbidden',
            404: 'removeErrorGone',
            // The workspace must keep an owner. Reachable when the last OWNER is aimed at by
            // another OWNER whose own membership disappeared underneath them.
            409: 'removeErrorLastOwner',
          },
        })
      }
    />
  );
}
