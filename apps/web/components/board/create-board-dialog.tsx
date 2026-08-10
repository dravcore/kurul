'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, CreateBoardRequest } from '@kurultay/shared-types';
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

interface CreateBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onCreated: (board: BoardDto) => void;
}

export function CreateBoardDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: CreateBoardDialogProps): React.ReactElement {
  const t = useTranslations('app.board');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: CreateBoardRequest = {
        name: name.trim(),
        description: description.trim() || null,
      };
      const board = await api.post<BoardDto>(`/workspaces/${workspaceId}/boards`, body);
      onCreated(board);
      setName('');
      setDescription('');
      onOpenChange(false);
    } catch {
      setError(t('createError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Radix focuses the content wrapper by default; take over so the name field
          // gets focus instead, without racing Radix's own focus-management effect.
          event.preventDefault();
          nameInputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-name">{t('name')}</Label>
            <Input
              id="board-name"
              ref={nameInputRef}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-description">{t('description')}</Label>
            <Input
              id="board-description"
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
              {t('createAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
