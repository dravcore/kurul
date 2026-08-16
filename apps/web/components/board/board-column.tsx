'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowLeft, ArrowRight, MoreHorizontal, Plus, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ColumnDto, TaskDto } from '@kurul/shared-types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SortableTaskCard } from '@/components/task/sortable-task-card';

/**
 * How many cards a column mounts before the reader has to scroll for the rest.
 *
 * This is a *render* budget, not a fetch budget: `use-board-data.ts` still drains every task
 * page into state, so the column header count, the filters and the drag arithmetic all keep
 * seeing the whole board. What is capped is how many of those rows become `SortableTaskCard`s
 * at once — which is the number the cost actually scales with. Each mounted card is a
 * `useSortable` subscriber, and dnd-kit re-runs every subscriber plus a rect measurement on
 * every pointer move of a drag, so the per-frame cost of dragging is linear in mounted cards
 * and completely independent of how many of them the reader can see.
 *
 * Measured on a seeded 1 000-task board (`SEED_LARGE_BOARD_TASKS=1000`, 5 columns, largest
 * holding 333), production build, drag driven at ~120 pointer moves/second for 4 s:
 *
 * | mounted cards | main thread busy | long tasks | median frame |
 * | ------------- | ---------------- | ---------- | ------------ |
 * | 1 000 (all)   | 99.9%            | 28 / 3.8 s | 132.7 ms     |
 * | 200 (this)    | 34.1%            | 0          | 33.3 ms      |
 *
 * Per processed move that is 84 ms of main-thread work before and 2.6 ms after. The frame
 * column is reported for completeness only — the machine this was measured on drives a 30 Hz
 * display, where `about:blank` itself measures 33.3 ms, so 33.3 is the floor and not a result.
 *
 * `content-visibility` on the cards (see `components/task/sortable-task-card.tsx`) is the
 * other half of this and does not replace it: on its own, with all 1 000 cards still mounted,
 * it took the median frame from 166.8 ms to 66.6 ms and left the main thread saturated. Paint
 * was roughly 60% of the cost; the React and dnd-kit remainder needs the cards to not exist.
 *
 * 40 is about three screens of cards at the ~56 px median a card occupies, so the first scroll
 * gesture never reaches the end of what is mounted.
 */
export const COLUMN_INITIAL_RENDER_BUDGET = 40;

/** How many more cards each reveal mounts. Same reasoning as the initial budget. */
export const COLUMN_RENDER_BUDGET_STEP = 40;

/**
 * How close to the end of the mounted cards the reader has to scroll before the next batch
 * mounts. Generous on purpose: the batch has to be in the DOM *before* it is scrolled into
 * view, or the reader sees the column end and stop.
 */
const REVEAL_MARGIN_PX = 800;

export function columnDroppableId(columnId: string): string {
  return `column:${columnId}`;
}

export function parseColumnDroppableId(id: string): string | null {
  return id.startsWith('column:') ? id.slice('column:'.length) : null;
}

interface BoardColumnProps {
  column: ColumnDto;
  tasks: TaskDto[];
  boardId: string;
  selectedTaskId?: string | null;
  canMutateColumns: boolean;
  canMutateTasks: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onOpenSettings: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onAddTask: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  tasks,
  boardId,
  selectedTaskId = null,
  canMutateColumns,
  canMutateTasks,
  canMoveLeft,
  canMoveRight,
  onOpenSettings,
  onDelete,
  onMoveLeft,
  onMoveRight,
  onAddTask,
  className,
  style,
}: BoardColumnProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const tTask = useTranslations('app.board.task');
  const { setNodeRef, isOver } = useDroppable({
    id: columnDroppableId(column.id),
    data: { type: 'column', columnId: column.id },
    disabled: !canMutateTasks,
  });

  const [renderBudget, setRenderBudget] = useState(COLUMN_INITIAL_RENDER_BUDGET);

  /**
   * The deep-linked task is rendered no matter where it sits in the column.
   *
   * Without this a task opened from a notification or a shared URL would show its panel over
   * a board on which its card is not mounted — the panel would work, but the card it belongs
   * to would be missing from the column until the reader scrolled far enough to mount it.
   * Stretching the budget instead of scrolling to it keeps the reveal one-directional: the
   * column never shows *fewer* cards than it did a moment ago.
   */
  const selectedIndex = selectedTaskId ? tasks.findIndex((task) => task.id === selectedTaskId) : -1;
  const renderCount = Math.min(tasks.length, Math.max(renderBudget, selectedIndex + 1));
  const visibleTasks = useMemo(() => tasks.slice(0, renderCount), [tasks, renderCount]);

  /**
   * `SortableContext` is handed the ids it can actually resolve to a mounted sortable, not
   * every id in the column. The two lists have to agree: the context derives each item's
   * index and neighbouring rect from this array, so an id in it with no node behind it is a
   * gap in the geometry the sorting strategy reads — and a card that is not mounted is not a
   * drop target under any list.
   */
  const visibleTaskIds = useMemo(() => visibleTasks.map((task) => task.id), [visibleTasks]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = renderCount < tasks.length;

  /**
   * Mount the next batch when the reader scrolls near the end of the current one.
   *
   * A sentinel rather than a "show more" button: the column already reports its true task
   * count in the header, so a control that has to be found and clicked would be the only
   * thing standing between the reader and rows the board says are there. Scrolling is what
   * they were already doing.
   *
   * The root is the **viewport**, deliberately not the column's own scroll container, and it
   * stays that way now that the column has one.
   *
   * When this was written the column did not scroll at all: `min-h-screen` on the shell left
   * the page's height chain unbounded, so a column's `overflow-y-auto` never clipped and the
   * document grew instead. A container root would have seen the sentinel as permanently in
   * view and revealed every batch back-to-back the moment the board loaded (measured: 1 000 of
   * 1 000 cards mounted, ~0 ms after the drain). Issue #184 has since bounded the chain
   * (`components/layout/app-shell.tsx`), so a container root would now work — but the viewport
   * root was never a workaround for that. An intersection is computed against every clipping
   * ancestor, so once the column clips, the sentinel is hidden by it and the two roots agree;
   * what the viewport root additionally survives is the chain being unbounded again, which is
   * exactly the class of regression a layout change makes. It is correct under both, and only
   * one of them is correct under both.
   *
   * The observer is re-created after each reveal because the sentinel moves with it;
   * re-observing is what lets a fast scroll pull in several batches in a row instead of
   * stalling at the first. It cannot run away: each batch pushes the sentinel a full batch of
   * cards further down.
   */
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    // jsdom has no IntersectionObserver, and neither does the server. Nothing to reveal
    // there — the initial budget is what those environments render, which is what the tests
    // assert against.
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRenderBudget((current) => current + COLUMN_RENDER_BUDGET_STEP);
        }
      },
      { rootMargin: `0px 0px ${REVEAL_MARGIN_PX}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, renderCount]);

  return (
    <section
      className={cn(
        'flex w-[var(--column-width)] min-w-[280px] max-w-[320px] shrink-0 flex-col rounded-[var(--radius-md)] bg-muted/60',
        isOver && 'bg-signature-subtle/50',
        className,
      )}
      style={style}
      aria-label={column.name}
    >
      {/* 40px per `docs/design.md` §4, 48px below `md` so the 44px overflow button fits inside
          it rather than spilling over the first card.

          `sticky` here only started meaning anything with the height-chain fix (#184): until
          the column had a scroll container of its own, this header was stuck to a box that
          never moved, and the reader scrolled the whole document past it. */}
      <header className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-muted/90 px-3 backdrop-blur-sm max-md:h-12">
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
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings2 />
                {t('settingsTitle')}
              </DropdownMenuItem>
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
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <SortableContext
          items={visibleTaskIds}
          strategy={verticalListSortingStrategy}
          disabled={!canMutateTasks}
        >
          {visibleTasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              boardId={boardId}
              selected={task.id === selectedTaskId}
              disabled={!canMutateTasks}
            />
          ))}
        </SortableContext>
        {hasMore ? (
          // Zero-height and aria-hidden: it is a scroll position, not content. The header's
          // task count is what tells a screen-reader user the column continues.
          <div ref={sentinelRef} aria-hidden className="h-px shrink-0" />
        ) : null}
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
});
