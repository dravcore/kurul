'use client';

import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface DeleteTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  task: TaskDto | null;
  onDeleted: (taskId: string) => void;
}

export function DeleteTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  task,
  onDeleted,
}: DeleteTaskDialogProps): React.ReactElement {
  const t = useTranslations('app.board.task');

  async function onConfirm(): Promise<void> {
    if (!task) return;
    await api.delete(`/workspaces/${workspaceId}/tasks/${task.id}`);
    onDeleted(task.id);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteTitle')}
      description={t('deleteBody', { title: task?.title ?? '' })}
      cancelLabel={t('cancel')}
      confirmLabel={t('deleteAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, { fallback: 'deleteError', byStatus: { 403: 'forbidden' } })
      }
    />
  );
}
