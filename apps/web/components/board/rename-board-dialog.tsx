'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, UpdateBoardRequest } from '@kurul/shared-types';
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
  const [name, setName] = useState(board?.name ?? '');
  const [description, setDescription] = useState(board?.description ?? '');

  // Load the fields when a different board is handed over, during render rather than from an
  // effect: the effect painted one frame of the *previous* board's name first, which is
  // visible every time the dialog is opened on a second board.
  //
  // Still nothing to do when `board` is null. That is the dialog closing, and Radix keeps the
  // content mounted while it animates out — blanking the fields mid-animation would be a new
  // flicker, not a fix. Compared by identity, exactly as the effect's dependency was.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (board && board !== syncedBoard) {
    setSyncedBoard(board);
    setName(board.name);
    setDescription(board.description ?? '');
  }

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
