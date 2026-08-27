'use client';

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
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
import type { TaskCardSignal } from '@/components/task/task-card';
import { TaskComposer } from './task-composer';

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

/** Shared empty map, so a board with nothing to report hands every column the same value. */
const NO_TASK_SIGNALS: ReadonlyMap<string, TaskCardSignal> = new Map();

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
  /** Null until the workspace has bootstrapped; the composer has nowhere to post without it. */
  workspaceId: string | null;
  selectedTaskId?: string | null;
  /** The slot the card in the air would land in, counted in cards; null when none is heading here. */
  dropIndicatorIndex: number | null;
  /** What the board last reported about each card, keyed by task id. Empty on a quiet board. */
  taskSignals?: ReadonlyMap<string, TaskCardSignal>;
  /**
   * Whether this column's heading is the strip's single tab stop. The board is a composite
   * widget (docs/design.md §5), so `BoardCanvas` roves one `tabIndex` 0 across the headings and
   * every other column carries -1.
   */
  headingTabbable: boolean;
  canMutateColumns: boolean;
  canMutateTasks: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /**
   * Every handler below takes what it acts on rather than being pre-bound to it by the caller.
   * A bound arrow would be a new function on each of the canvas's renders and would defeat the
   * `memo` this component is wrapped in for every column at once, drag included.
   */
  onOpenSettings: (column: ColumnDto) => void;
  onDelete: (column: ColumnDto) => void;
  onMoveColumn: (column: ColumnDto, direction: -1 | 1) => void;
  /** One composer is open on the board at a time, so the canvas owns which column has it. */
  composerOpen: boolean;
  composerFocusNonce: number;
  onComposerOpenChange: (columnId: string, open: boolean) => void;
  onTaskCreated: (task: TaskDto) => void;
  className?: string;
  /** This column's place in the entrance stagger, or null once the stagger has played. */
  staggerIndex: number | null;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  tasks,
  boardId,
  workspaceId,
  selectedTaskId = null,
  dropIndicatorIndex,
  taskSignals = NO_TASK_SIGNALS,
  headingTabbable,
  canMutateColumns,
  canMutateTasks,
  canMoveLeft,
  canMoveRight,
  onOpenSettings,
  onDelete,
  onMoveColumn,
  composerOpen,
  composerFocusNonce,
  onComposerOpenChange,
  onTaskCreated,
  className,
  staggerIndex,
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

  /**
   * The rail is drawn at the end of what is mounted when the drop lands past it. The render
   * budget is what the column can address at all, and an unmounted card is not a drop target
   * under any list, so the last mounted slot is the closest true statement the column can make.
   */
  const railIndex =
    dropIndicatorIndex === null ? null : Math.min(dropIndicatorIndex, visibleTasks.length);

  /**
   * The rail gives back the ten pixels it costs the column: its own two, and the eight the
   * `gap-2` above adds for one more child. @dnd-kit measures each droppable once, when the drag
   * begins, and it measures with transforms stripped but layout kept, so a mark that reserved
   * card height would leave every rect below it stale by that height for the rest of the drag
   * and the hit test would keep resolving to a card the reader is no longer over.
   */
  const rail = (
    <div aria-hidden data-slot="drop-indicator" className="-my-[5px] h-0.5 shrink-0 bg-signature" />
  );

  const addTaskRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef(false);

  /**
   * Focus goes back to the `Add task` button the composer replaced, once the button is back in
   * the DOM to receive it.
   */
  useEffect(() => {
    if (composerOpen || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    addTaskRef.current?.focus();
  }, [composerOpen]);

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

  /**
   * `isOver` is the pointer's half only: a keyboard drag makes the lifted card a sortable item
   * of the column it moves into, so this column's own droppable never turns over and the wash
   * would be a mouse-only affordance. The indicator is raised for both devices.
   */
  const isDropTarget = isOver || railIndex !== null;

  // Built here rather than handed down as a `style` object, which would be a fresh value on
  // every render of the canvas and would defeat this component's `memo` for every column.
  // `app/globals.css` turns the index into the entrance animation's delay.
  const style =
    staggerIndex === null
      ? undefined
      : ({ '--stagger-index': staggerIndex } as React.CSSProperties);

  return (
    <section
      className={cn(
        'flex w-[var(--column-width)] min-w-[280px] max-w-[320px] shrink-0 flex-col rounded-md bg-muted',
        // Below `md` the column is 85vw (`--column-width` in app/globals.css) and snaps under
        // the thumb, so the desktop 280-320px clamp has to come off or a wide phone would be
        // handed a 320px column inside a 430px viewport and the snap would leave a slice of the
        // next one showing on every stop.
        'max-md:max-w-none max-md:min-w-0 max-md:snap-start',
        isDropTarget && 'bg-signature-subtle',
        className,
      )}
      style={style}
      aria-label={column.name}
      // Forced colours erase the tint above, so `app/globals.css` hangs the drop target's
      // Highlight border on this attribute instead.
      data-drop-target={isDropTarget || undefined}
    >
      {/* 40px per `docs/design.md` §4, 48px below `md` so the 44px overflow button fits inside
          it rather than spilling over the first card.

          `sticky` here only started meaning anything with the height-chain fix (#184): until
          the column had a scroll container of its own, this header was stuck to a box that
          never moved, and the reader scrolled the whole document past it. */}
      <header className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-muted/90 px-3 backdrop-blur-sm max-md:h-12">
        {/* The handle of a composite widget (docs/design.md §5): `Tab` reaches one column and
            keys move between them from there, so exactly one heading on the board is at 0 and
            the rest are at -1. `board-canvas.tsx` roves that stop with Home, End and Ctrl plus
            an arrow. The heading text is the whole announcement, so nothing extra is said. */}
        <h2
          data-slot="column-heading"
          // The rule reads a heading as static; this one is the composite widget's handle.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={headingTabbable ? 0 : -1}
          className="min-w-0 flex-1 truncate text-body font-strong"
        >
          {column.name}
        </h2>
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
              <DropdownMenuItem onClick={() => onOpenSettings(column)}>
                <Settings2 />
                {t('settingsTitle')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveLeft} onClick={() => onMoveColumn(column, -1)}>
                <ArrowLeft />
                {t('moveLeft')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveRight} onClick={() => onMoveColumn(column, 1)}>
                <ArrowRight />
                {t('moveRight')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(column)}>
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
          {visibleTasks.map((task, index) => (
            <Fragment key={task.id}>
              {railIndex === index ? rail : null}
              <SortableTaskCard
                task={task}
                boardId={boardId}
                selected={task.id === selectedTaskId}
                signal={taskSignals.get(task.id) ?? null}
                disabled={!canMutateTasks}
              />
            </Fragment>
          ))}
          {railIndex === visibleTasks.length ? rail : null}
        </SortableContext>
        {hasMore ? (
          // Zero-height and aria-hidden: it is a scroll position, not content. The header's
          // task count is what tells a screen-reader user the column continues.
          <div ref={sentinelRef} aria-hidden className="h-px shrink-0" />
        ) : null}
        {tasks.length === 0 ? (
          <div className="flex h-14 items-center justify-center rounded-md border border-border-strong text-small text-muted-foreground">
            {t('emptyDrop')}
          </div>
        ) : null}
        {canMutateTasks && workspaceId !== null ? (
          composerOpen ? (
            <TaskComposer
              workspaceId={workspaceId}
              boardId={boardId}
              columnId={column.id}
              focusNonce={composerFocusNonce}
              onCreated={onTaskCreated}
              onClose={(returnFocus) => {
                returnFocusRef.current = returnFocus;
                onComposerOpenChange(column.id, false);
              }}
            />
          ) : (
            <Button
              ref={addTaskRef}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => onComposerOpenChange(column.id, true)}
            >
              <Plus />
              {tTask('createAction')}
            </Button>
          )
        ) : null}
      </div>
    </section>
  );
});
