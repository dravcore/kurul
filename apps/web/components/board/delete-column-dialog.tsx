'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDto } from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(): Promise<void> {
    if (!column) return;
    setPending(true);
    setError(null);
    try {
      await api.delete(`/workspaces/${workspaceId}/columns/${column.id}`);
      onDeleted(column.id);
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setError(t('forbidden'));
      } else {
        setError(t('deleteError'));
      }
    } finally {
      setPending(false);
    }
  }

  const taskCount = column?.taskCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>
            {taskCount > 0
              ? t('deleteBodyWithTasks', { name: column?.name ?? '', count: taskCount })
              : t('deleteBody', { name: column?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {t('deleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
