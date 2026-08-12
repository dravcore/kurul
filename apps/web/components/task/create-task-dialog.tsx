'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreateTaskRequest, TaskDto } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  boardId: string;
  columnId: string;
  onCreated: (task: TaskDto) => void;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  boardId,
  columnId,
  onCreated,
}: CreateTaskDialogProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');

  async function onSubmit(): Promise<void> {
    const body: CreateTaskRequest = { title: title.trim(), columnId };
    const task = await api.post<TaskDto, CreateTaskRequest>(
      `/workspaces/${workspaceId}/boards/${boardId}/tasks`,
      body,
    );
    onCreated(task);
    setTitle('');
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('createAction')}
      submitDisabled={title.trim().length === 0}
      initialFocusRef={titleInputRef}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, { fallback: 'createError', byStatus: { 403: 'forbidden' } })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">{t('title')}</Label>
        <Input
          id="task-title"
          ref={titleInputRef}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}
