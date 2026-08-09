'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDto } from '@kurultay/shared-types';
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

interface RenameColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  column: ColumnDto | null;
  onRenamed: (column: ColumnDto) => void;
}

export function RenameColumnDialog({
  open,
  onOpenChange,
  workspaceId,
  column,
  onRenamed,
}: RenameColumnDialogProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (column) {
      setName(column.name);
      setError(null);
    }
  }, [column]);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!column) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<ColumnDto>(
        `/workspaces/${workspaceId}/columns/${column.id}`,
        { name: name.trim() },
      );
      onRenamed(updated);
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 403) {
        setError(t('forbidden'));
      } else {
        setError(t('renameError'));
      }
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
            <Label htmlFor="rename-column-name">{t('name')}</Label>
            <Input
              id="rename-column-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
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
