'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { AttachmentDto } from '@kurultay/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AttachmentAddLink } from './attachment-add-link';
import { AttachmentRow } from './attachment-row';

export interface TaskAttachmentsProps {
  workspaceId: string;
  /**
   * The attachments that were read. Empty is a real answer here — "not read yet" is `loading`
   * and "the read failed" is `loadFailed`, because `[]` on its own cannot tell the three apart.
   */
  attachments: AttachmentDto[];
  canMutate?: boolean;
  /**
   * Whether this API instance stores bytes at all (`GET /config`'s `attachmentsEnabled`, which
   * follows `STORAGE_PATH`). Only the file control depends on it — see the note below.
   */
  storageEnabled?: boolean;
  /** A write is in flight somewhere in this section. */
  pending?: boolean;
  loading?: boolean;
  loadFailed?: boolean;
  onUpload?: (file: File) => Promise<boolean>;
  onAddLink?: (url: string, label: string) => Promise<boolean>;
  onRemove?: (attachmentId: string) => void;
}

/**
 * The task panel's attachment surface.
 *
 * Its own component rather than another section inside `task-metadata-panel.tsx`, which is
 * already the widest file in this folder and is the subject of issue #41 — the same reasoning
 * `task-checklists.tsx` was split out under.
 *
 * **Storage being off does not turn the section off.** An instance with no `STORAGE_PATH` stores
 * no bytes, so the file control is not rendered; a LINK stores nothing but a string, so links
 * keep working and existing rows of both kinds stay listed and deletable. Hiding the whole
 * section would make files that already exist — uploaded before the operator unset the path, or
 * restored from a backup — unreachable and undeletable through the UI.
 */
export function TaskAttachments({
  workspaceId,
  attachments,
  canMutate = true,
  storageEnabled = true,
  pending = false,
  loading = false,
  loadFailed = false,
  onUpload,
  onAddLink,
  onRemove,
}: TaskAttachmentsProps): React.ReactElement | null {
  const t = useTranslations('app.board.task.attachments');
  const fileId = useId();

  const canUpload = canMutate && storageEnabled && onUpload !== undefined;
  const canAddLink = canMutate && onAddLink !== undefined;

  // Nothing to show and nothing to offer. An empty section would put a heading over a void on
  // every task a viewer opens, and most tasks have no attachment.
  if (!loading && !loadFailed && attachments.length === 0 && !canUpload && !canAddLink) {
    return null;
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // The input is cleared either way: without it, picking the same file twice in a row fires
    // no `change` event at all, and a failed upload could not be retried from the same file.
    event.target.value = '';
    if (file === undefined || onUpload === undefined) return;
    void onUpload(file);
  }

  return (
    <section aria-label={t('sectionLabel')} className="flex flex-col gap-3">
      <p className="text-small font-medium text-foreground">{t('sectionLabel')}</p>

      {loading ? (
        <p className="text-small text-muted-foreground">{t('loading')}</p>
      ) : loadFailed ? (
        <p className="text-small text-muted-foreground">{t('loadError')}</p>
      ) : (
        <>
          {attachments.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {attachments.map((attachment) => (
                <AttachmentRow
                  key={attachment.id}
                  workspaceId={workspaceId}
                  attachment={attachment}
                  disabled={pending}
                  onRemove={canMutate && onRemove ? onRemove : undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted-foreground">{t('empty')}</p>
          )}

          {canUpload ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fileId}>{t('addFile')}</Label>
              <Input id={fileId} type="file" disabled={pending} onChange={pick} />
            </div>
          ) : canMutate && !storageEnabled ? (
            <p className="text-small text-muted-foreground">{t('storageOff')}</p>
          ) : null}

          {canAddLink && onAddLink ? (
            <AttachmentAddLink pending={pending} onAddLink={onAddLink} />
          ) : null}
        </>
      )}
    </section>
  );
}
