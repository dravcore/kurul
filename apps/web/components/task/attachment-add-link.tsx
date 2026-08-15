'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface AttachmentAddLinkProps {
  /** A write is in flight somewhere in the section; the form stays visible but inert. */
  pending?: boolean;
  onAddLink: (url: string, label: string) => Promise<boolean>;
}

/**
 * The "attach a link" form.
 *
 * Behind a disclosure rather than always open, because a LINK is the rarer of the two kinds and
 * two permanently visible fields would push the metadata panel below the fold on a task with no
 * attachments at all.
 *
 * The only client-side check is that the URL field is not blank, and that is on purpose: the
 * rule that matters — `http:` or `https:` and nothing else — is enforced by the server (ADR 0024
 * K7), which is the only place it can be enforced. Repeating it here would produce a second
 * implementation whose disagreement with the first is invisible until it matters, and would read
 * to the next person like the check. What this one buys is that a stray Enter is not a round
 * trip.
 */
export function AttachmentAddLink({
  pending = false,
  onAddLink,
}: AttachmentAddLinkProps): React.ReactElement {
  const t = useTranslations('app.board.task.attachments');
  const urlId = useId();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  async function submit(): Promise<void> {
    if (url.trim().length === 0) return;
    const added = await onAddLink(url, label);
    if (!added) return;
    setUrl('');
    setLabel('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('addLink')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label htmlFor={urlId}>{t('linkUrl')}</Label>
        <Input
          id={urlId}
          value={url}
          disabled={pending}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void submit();
          }}
        />
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label htmlFor={labelId}>{t('linkLabel')}</Label>
        <Input
          id={labelId}
          value={label}
          disabled={pending}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void submit();
          }}
        />
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
        {t('linkSubmit')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setOpen(false)}
      >
        {t('linkCancel')}
      </Button>
    </div>
  );
}
