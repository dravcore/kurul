'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDto, CreateColumnRequest } from '@kurultay/shared-types';
import { ApiError, api } from '@/lib/api';
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

interface CreateColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  boardId: string;
  afterColumnId?: string | null;
  onCreated: (column: ColumnDto) => void;
}

export function CreateColumnDialog({
  open,
  onOpenChange,
  workspaceId,
  boardId,
  afterColumnId,
  onCreated,
}: CreateColumnDialogProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: CreateColumnRequest = {
        name: name.trim(),
        ...(afterColumnId ? { afterColumnId } : {}),
      };
      const column = await api.post<ColumnDto>(
        `/workspaces/${workspaceId}/boards/${boardId}/columns`,
        body,
      );
      onCreated(column);
      setName('');
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setError(t('forbidden'));
      } else {
        setError(t('createError'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="column-name">{t('name')}</Label>
            <Input
              id="column-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
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
