'use client';

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskDto } from '@kurultay/shared-types';
import { cn } from '@/lib/utils';
import { LabelDots } from './label-chip';
import { PriorityIcon } from './priority-icon';
import { TaskCard } from './task-card';

interface SortableTaskCardProps {
  task: TaskDto;
  boardId: string;
  selected?: boolean;
  disabled?: boolean;
}

export const SortableTaskCard = memo(function SortableTaskCard({
  task,
  boardId,
  selected = false,
  disabled = false,
}: SortableTaskCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        boardId={boardId}
        selected={selected}
        className={cn(isDragging && 'shadow-drag')}
      />
    </div>
  );
});

/** Drag overlay preview — matches design.md lift treatment. */
export function TaskDragPreview({ task }: { task: TaskDto }): React.ReactElement {
  return (
    <div className="w-[min(280px,80vw)] scale-[1.02] rotate-[1deg] rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 shadow-drag motion-reduce:rotate-0 motion-reduce:scale-100">
      <div className="flex items-start gap-1.5">
        <PriorityIcon priority={task.priority} className="mt-0.5" />
        <span className="line-clamp-2 min-w-0 flex-1 text-body text-foreground">{task.title}</span>
      </div>
      <LabelDots labels={task.labels} className="mt-1.5" />
    </div>
  );
}
