'use client';

import { useTranslations } from 'next-intl';
import type { ColumnDto } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface DeleteColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  column: ColumnDto | null;
  onDeleted: (columnId: string) => void;
}

export function DeleteColumnDialog({
  open,
  onOpenChange,
  workspaceId,
  column,
  onDeleted,
}: DeleteColumnDialogProps): React.ReactElement {
  const t = useTranslations('app.board.column');

  const taskCount = column?.taskCount ?? 0;
  const blocked = taskCount > 0;

  async function onConfirm(): Promise<void> {
    if (!column || blocked) return;
    await api.delete(`/workspaces/${workspaceId}/columns/${column.id}`);
    onDeleted(column.id);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteTitle')}
      description={
        blocked
          ? t('deleteBodyWithTasks', { name: column?.name ?? '', count: taskCount })
          : t('deleteBody', { name: column?.name ?? '' })
      }
      cancelLabel={t('cancel')}
      confirmLabel={t('deleteAction')}
      destructive
      confirmDisabled={blocked}
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'deleteError',
          byStatus: { 403: 'forbidden', 409: 'deleteBlocked' },
        })
      }
    />
  );
}
