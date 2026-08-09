'use client';

import { ArrowLeft, ArrowRight, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ColumnDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BoardColumnProps {
  column: ColumnDto;
  canMutate: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function BoardColumn({
  column,
  canMutate,
  canMoveLeft,
  canMoveRight,
  onRename,
  onDelete,
  onMoveLeft,
  onMoveRight,
  className,
  style,
}: BoardColumnProps): React.ReactElement {
  const t = useTranslations('app.board.column');

  return (
    <section
      className={cn(
        'flex w-[var(--column-width)] min-w-[280px] max-w-[320px] shrink-0 flex-col rounded-[var(--radius-md)] bg-muted/60',
        className,
      )}
      style={style}
      aria-label={column.name}
    >
      <header className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-muted/90 px-3 backdrop-blur-sm">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{column.name}</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {column.taskCount}
        </span>
        {canMutate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('menu')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>{t('renameAction')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveLeft} onClick={onMoveLeft}>
                <ArrowLeft />
                {t('moveLeft')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveRight} onClick={onMoveRight}>
                <ArrowRight />
                {t('moveRight')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                {t('deleteAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        <div className="flex h-14 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong text-xs text-muted-foreground">
          {t('emptyDrop')}
        </div>
      </div>
    </section>
  );
}
