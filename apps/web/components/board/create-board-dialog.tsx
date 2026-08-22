'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardDto, CreateBoardRequest } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { BoardTemplatePicker } from '@/components/board/board-template-picker';
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
  // No slug is spelled out here: the picker learns the catalog from the API and reports back
  // whichever it settled on. `null` means it has not answered yet, or could not — and an
  // omitted `template` is the pre-templates behaviour, so the board still comes out usable.
  const [template, setTemplate] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    const body: CreateBoardRequest = {
      name: name.trim(),
      description: description.trim() || null,
      ...(template === null ? {} : { template }),
    };
    const board = await api.post<BoardDto, CreateBoardRequest>(
      `/workspaces/${workspaceId}/boards`,
      body,
    );
    onCreated(board);
    setName('');
    setDescription('');
    // Back to "the picker decides" rather than to the last choice: the next board is a new
    // decision, and the dialog reopens on the catalog's default the way it did the first time.
    setTemplate(null);
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
      <BoardTemplatePicker workspaceId={workspaceId} value={template} onChange={setTemplate} />
    </FormDialog>
  );
}
