'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto } from '@kurultay/shared-types';
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(): Promise<void> {
    if (!board) return;
    setPending(true);
    setError(null);
    try {
      await api.delete(`/workspaces/${workspaceId}/boards/${board.id}`);
      onDeleted(board.id);
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setError(t('errors.forbiddenDelete'));
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
          <DialogDescription>{t('deleteBody', { name: board?.name ?? '' })}</DialogDescription>
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
