'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDto, UpdateColumnRequest } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
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

  useEffect(() => {
    if (column) setName(column.name);
  }, [column]);

  async function onSubmit(): Promise<void> {
    if (!column) return;
    const body: UpdateColumnRequest = { name: name.trim() };
    const updated = await api.patch<ColumnDto, UpdateColumnRequest>(
      `/workspaces/${workspaceId}/columns/${column.id}`,
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
      resolveError={(caught) =>
        resolveApiMessage(caught, t, { fallback: 'renameError', byStatus: { 403: 'forbidden' } })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rename-column-name">{t('name')}</Label>
        <Input
          id="rename-column-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}
