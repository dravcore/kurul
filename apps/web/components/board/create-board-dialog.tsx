'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, CreateBoardRequest } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
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

  async function onSubmit(): Promise<void> {
    const body: CreateBoardRequest = {
      name: name.trim(),
      description: description.trim() || null,
    };
    const board = await api.post<BoardDto, CreateBoardRequest>(
      `/workspaces/${workspaceId}/boards`,
      body,
    );
    onCreated(board);
    setName('');
    setDescription('');
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('createAction')}
      submitDisabled={name.trim().length === 0}
      initialFocusRef={nameInputRef}
      onSubmit={onSubmit}
      resolveError={(caught) => resolveApiMessage(caught, t, { fallback: 'createError' })}
    >
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
    </FormDialog>
  );
}
