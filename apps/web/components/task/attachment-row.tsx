'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, File as FileIcon, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type AttachmentDto, AttachmentKind } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { api, getApiBaseUrl } from '@/lib/api';

/**
 * The four types the API serves `inline` (ADR 0024 K4), and therefore the only ones worth
 * previewing.
 *
 * A second copy of `apps/api/src/attachment/attachment-mime.ts`'s `INLINE_MIME_TYPES` rather
 * than a shared constant, because the two answer different questions: the server's list decides
 * a response header on bytes it has sniffed, this one decides whether the panel spends a request
 * on a thumbnail. A type added on the server and not here shows as a plain row — the safe
 * direction. The reverse is also safe: an image the server will not serve inline is still
 * downloaded correctly by the anchor, the preview simply fails and is dropped.
 *
 * `image/svg+xml` is absent from both, and for the same reason: SVG is markup (K3).
 */
const PREVIEWABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export interface AttachmentRowProps {
  workspaceId: string;
  attachment: AttachmentDto;
  /** Omit to render a read-only row — a viewer, or a write already in flight. */
  onRemove?: (attachmentId: string) => void;
  disabled?: boolean;
}

/** The API path the bytes of a stored file live at. Built from `id`; the DTO carries no URL. */
function contentPath(workspaceId: string, attachmentId: string): string {
  return `/workspaces/${workspaceId}/attachments/${attachmentId}/content`;
}

/**
 * An object URL for an image attachment, released when it stops being shown.
 *
 * The bytes are fetched rather than pointed at with `<img src>`, and that is not a stylistic
 * choice: on a split-domain deployment the API is another origin, and the web CSP's `img-src`
 * names no host (`lib/security-headers.ts`) — a direct `src` is refused there while a `fetch`
 * through `connect-src` is not. Going through `lib/api.ts` also keeps the session cookie and
 * the shared `ApiError` path, so a preview on a task the user has lost access to fails the same
 * way every other read does.
 *
 * `URL.revokeObjectURL` in the cleanup is the whole reason this is a hook. An object URL is a
 * strong reference held by the document, not by the variable: without the revoke, every task
 * the reader opens leaves the full bytes of its images pinned in memory for the lifetime of the
 * tab. `revoked` guards the other order — an unmount while the fetch is still in flight, where
 * the cleanup has already run and there is nothing yet to revoke.
 */
function useObjectUrl(path: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (path === null) return;

    let revoked = false;
    let created: string | null = null;

    void (async () => {
      try {
        const blob = await api.getBlob(path);
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        // No preview. The row still carries the filename and the download link, which is the
        // part that matters; a broken-image placeholder would say less than nothing.
      }
    })();

    return () => {
      revoked = true;
      if (created !== null) URL.revokeObjectURL(created);
      setObjectUrl(null);
    };
  }, [path]);

  return objectUrl;
}

/**
 * One attachment.
 *
 * A LINK is an ordinary external anchor with `target="_blank" rel="noopener noreferrer"`: the
 * `rel` is not decoration — `noopener` keeps the opened page from reaching back through
 * `window.opener` and `noreferrer` keeps the board URL out of its `Referer`. The server has
 * never fetched this URL and never will (ADR 0024 K7); everything the user sees about it is the
 * text they typed, which is also why the visible label is the row's own text and never anything
 * read off the target.
 *
 * A FILE is an `<a download>` at the API's content endpoint. No `fetch`, no `blob:`: in the
 * shipped image the API base is the same-origin path `/api`, so the session cookie rides along
 * on a plain navigation and the browser does the download with no JavaScript at all. The
 * preview above it is the one place bytes are fetched, and only for the four image types.
 */
export function AttachmentRow({
  workspaceId,
  attachment,
  onRemove,
  disabled = false,
}: AttachmentRowProps): React.ReactElement {
  const t = useTranslations('app.board.task.attachments');
  const isLink = attachment.kind === AttachmentKind.Link;
  const previewable =
    !isLink && attachment.mimeType !== null && PREVIEWABLE_MIME_TYPES.has(attachment.mimeType);
  const previewUrl = useObjectUrl(previewable ? contentPath(workspaceId, attachment.id) : null);

  return (
    <li className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {isLink ? (
          <a
            href={attachment.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('openLink', { filename: attachment.filename })}
            className="inline-flex min-w-0 items-center gap-1.5 text-body text-foreground underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{attachment.filename}</span>
          </a>
        ) : (
          <a
            href={`${getApiBaseUrl()}${contentPath(workspaceId, attachment.id)}`}
            download={attachment.filename}
            aria-label={t('download', { filename: attachment.filename })}
            className="inline-flex min-w-0 items-center gap-1.5 text-body text-foreground underline-offset-4 hover:underline"
          >
            <FileIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{attachment.filename}</span>
          </a>
        )}

        {previewUrl !== null ? (
          /*
            A plain `<img>` rather than `next/image`: the optimizer needs a URL it can fetch
            from the server, and this one exists only in the browser that created it. The
            alt text is the filename because that is the only description this app has —
            the server never looks at the bytes beyond sniffing their type.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={attachment.filename}
            className="max-h-40 w-fit max-w-full rounded-[var(--radius-md)] border border-border object-contain"
          />
        ) : null}
      </div>

      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t('remove', { filename: attachment.filename })}
          onClick={() => onRemove(attachment.id)}
        >
          <Trash2 />
        </Button>
      ) : null}
    </li>
  );
}
