'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RenameBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  board: BoardDto | null;
  onRenamed: (board: BoardDto) => void;
}

export function RenameBoardDialog({
  open,
  onOpenChange,
  workspaceId,
  board,
  onRenamed,
}: RenameBoardDialogProps): React.ReactElement {
  const t = useTranslations('app.board');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (board) {
      setName(board.name);
      setDescription(board.description ?? '');
      setError(null);
    }
  }, [board]);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!board) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<BoardDto>(`/workspaces/${workspaceId}/boards/${board.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      });
      onRenamed(updated);
      onOpenChange(false);
    } catch {
      setError(t('renameError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('renameTitle')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-board-name">{t('name')}</Label>
            <Input
              id="rename-board-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-board-description">{t('description')}</Label>
            <Input
              id="rename-board-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error ? <p className="text-body text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending || name.trim().length === 0}>
              {t('renameAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
