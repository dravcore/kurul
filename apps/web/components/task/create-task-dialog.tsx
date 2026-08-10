'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreateTaskRequest, TaskDto } from '@kurultay/shared-types';
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: CreateTaskRequest = { title: title.trim(), columnId };
      const task = await api.post<TaskDto>(
        `/workspaces/${workspaceId}/boards/${boardId}/tasks`,
        body,
      );
      onCreated(task);
      setTitle('');
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
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Radix focuses the content wrapper by default; take over so the title field
          // gets focus instead, without racing Radix's own focus-management effect.
          event.preventDefault();
          titleInputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
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
          {error ? <p className="text-body text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending || title.trim().length === 0}>
              {t('createAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
