'use client';

import { useTranslations } from 'next-intl';
import type { PersonalAccessTokenDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface RevokeTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  token: PersonalAccessTokenDto | null;
  onRevoked: (tokenId: string) => void;
}

export function RevokeTokenDialog({
  open,
  onOpenChange,
  workspaceId,
  token,
  onRevoked,
}: RevokeTokenDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.tokens');

  async function onConfirm(): Promise<void> {
    if (!token) return;
    await api.delete(`/workspaces/${workspaceId}/tokens/${token.id}`);
    onRevoked(token.id);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('revokeTitle')}
      description={t('revokeBody', { name: token?.name ?? '' })}
      cancelLabel={t('cancel')}
      confirmLabel={t('revokeAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'revokeError',
          byStatus: {
            // Someone else revoked it, or it expired, while this dialog was open.
            404: 'revokeErrorGone',
          },
        })
      }
    />
  );
}
