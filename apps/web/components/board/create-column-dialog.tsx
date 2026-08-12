'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDto, CreateColumnRequest } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  async function onSubmit(): Promise<void> {
    const body: CreateColumnRequest = {
      name: name.trim(),
      ...(afterColumnId ? { afterColumnId } : {}),
    };
    const column = await api.post<ColumnDto, CreateColumnRequest>(
      `/workspaces/${workspaceId}/boards/${boardId}/columns`,
      body,
    );
    onCreated(column);
    setName('');
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
      resolveError={(caught) =>
        resolveApiMessage(caught, t, { fallback: 'createError', byStatus: { 403: 'forbidden' } })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="column-name">{t('name')}</Label>
        <Input
          id="column-name"
          ref={nameInputRef}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}
