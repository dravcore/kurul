'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: TaskDto;
  boardId: string;
  selected?: boolean;
  className?: string;
}

export function TaskCard({
  task,
  boardId,
  selected = false,
  className,
}: TaskCardProps): React.ReactElement {
  const t = useTranslations('app.board.task');

  return (
    <Link
      href={`/board/${boardId}/task/${task.id}`}
      data-rail-active={selected || undefined}
      className={cn(
        'block rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-left transition-colors',
        'hover:border-border-strong hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'border-signature bg-signature-subtle/40',
        className,
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="sr-only">{t('openTask')}</span>
      <span className="line-clamp-2 text-body text-foreground">{task.title}</span>
    </Link>
  );
}
