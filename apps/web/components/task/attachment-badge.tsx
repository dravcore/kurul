'use client';

import { Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * How many attachments a task has, on a board card.
 *
 * Renders nothing at all when there are none — zero nodes, not a hidden one, for the same
 * reason `checklist-badge.tsx` does: this mounts once per card on a surface P2-8 spent a whole
 * task making cheap, and "no attachments" is the common case.
 *
 * The number is read from `TaskDto.attachmentCount`, which the board's list query fills with a
 * Prisma `_count` — a correlated subquery, never the rows (decision D2). The rows exist only
 * behind the panel's own endpoint.
 *
 * Two channels carry the meaning, neither of them colour: the glyph says the number counts
 * attachments rather than comments or items, and the label spells it out for assistive tech,
 * which would otherwise be handed a bare digit. `Paperclip` is a single-path Lucide glyph, the
 * same shape constraint `ChecklistBadge` measured its icon against.
 */
export function AttachmentBadge({ count }: { count: number }): React.ReactElement | null {
  const t = useTranslations('app.board.task.attachments');
  if (count === 0) return null;

  return (
    <span className="inline-flex items-center gap-1" aria-label={t('count', { count })}>
      <Paperclip className="size-3 shrink-0" aria-hidden />
      <span>{count}</span>
    </span>
  );
}
