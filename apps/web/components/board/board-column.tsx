'use client';

import { ArrowLeft, ArrowRight, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TaskCard } from '@/components/task/task-card';

interface BoardColumnProps {
  column: ColumnDto;
  tasks: TaskDto[];
  boardId: string;
  selectedTaskId?: string | null;
  canMutateColumns: boolean;
  canMutateTasks: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onAddTask: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function BoardColumn({
  column,
  tasks,
  boardId,
  selectedTaskId = null,
  canMutateColumns,
  canMutateTasks,
  canMoveLeft,
  canMoveRight,
  onRename,
  onDelete,
  onMoveLeft,
  onMoveRight,
  onAddTask,
  className,
  style,
}: BoardColumnProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const tTask = useTranslations('app.board.task');

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
        <h2 className="min-w-0 flex-1 truncate text-body font-medium">{column.name}</h2>
        <span className="font-mono text-small text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
        {canMutateColumns ? (
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
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            boardId={boardId}
            selected={task.id === selectedTaskId}
          />
        ))}
        {tasks.length === 0 ? (
          <div className="flex h-14 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong text-small text-muted-foreground">
            {t('emptyDrop')}
          </div>
        ) : null}
        {canMutateTasks ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={onAddTask}
          >
            <Plus />
            {tTask('createAction')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
