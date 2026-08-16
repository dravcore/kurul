'use client';

import { useTranslations } from 'next-intl';
import type { BoardDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface DeleteBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  board: BoardDto | null;
  onDeleted: (boardId: string) => void;
}

export function DeleteBoardDialog({
  open,
  onOpenChange,
  workspaceId,
  board,
  onDeleted,
}: DeleteBoardDialogProps): React.ReactElement {
  const t = useTranslations('app.board');

  async function onConfirm(): Promise<void> {
    if (!board) return;
    await api.delete(`/workspaces/${workspaceId}/boards/${board.id}`);
    onDeleted(board.id);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteTitle')}
      description={t('deleteBody', { name: board?.name ?? '' })}
      cancelLabel={t('cancel')}
      confirmLabel={t('deleteAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'deleteError',
          byStatus: { 403: 'errors.forbiddenDelete' },
        })
      }
    />
  );
}
