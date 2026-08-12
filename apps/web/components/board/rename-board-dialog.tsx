'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, UpdateBoardRequest } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
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

  useEffect(() => {
    if (board) {
      setName(board.name);
      setDescription(board.description ?? '');
    }
  }, [board]);

  async function onSubmit(): Promise<void> {
    if (!board) return;
    const body: UpdateBoardRequest = {
      name: name.trim(),
      description: description.trim() || null,
    };
    const updated = await api.patch<BoardDto, UpdateBoardRequest>(
      `/workspaces/${workspaceId}/boards/${board.id}`,
      body,
    );
    onRenamed(updated);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('renameTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('renameAction')}
      submitDisabled={name.trim().length === 0}
      onSubmit={onSubmit}
      resolveError={(caught) => resolveApiMessage(caught, t, { fallback: 'renameError' })}
    >
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
    </FormDialog>
  );
}
