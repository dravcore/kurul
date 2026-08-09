'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurultay/shared-types';
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(): Promise<void> {
    if (!task) return;
    setPending(true);
    setError(null);
    try {
      await api.delete(`/workspaces/${workspaceId}/tasks/${task.id}`);
      onDeleted(task.id);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteBody', { title: task?.title ?? '' })}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-body text-destructive">{error}</p> : null}
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
