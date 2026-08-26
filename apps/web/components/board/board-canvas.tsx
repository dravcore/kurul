'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DropAnimation,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { ColumnDto, TaskDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { TaskDragPreview } from '@/components/task/sortable-task-card';
import type { TaskCardSignal } from '@/components/task/task-card';
import type { BoardTaskDndController } from '@/components/task/use-board-task-dnd';
import { BoardColumn } from './board-column';
import { useCreateTaskShortcut } from './use-create-task-shortcut';
import { useReducedMotion } from './use-reduced-motion';

/** Which edge of the column strip still has columns beyond it. */
type BoardOverflow = 'left' | 'right' | 'both';

const COLUMN_HEADING = '[data-slot="column-heading"]';

/**
 * A fractional column width leaves a sub-pixel remainder at either end of the strip, which is
 * not content to scroll to; one pixel of slack is what keeps a mask off a strip that is already
 * at its end.
 */
const SCROLL_EPSILON_PX = 1;

function overflowOf(scroller: HTMLElement): BoardOverflow | null {
  const left = scroller.scrollLeft > SCROLL_EPSILON_PX;
  const right =
    scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - SCROLL_EPSILON_PX;
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

interface BoardCanvasProps {
  boardId: string;
  workspaceId: string | null;
  columns: ColumnDto[];
  tasksByColumn: Map<string, TaskDto[]>;
  selectedTaskId: string | null;
  /** What the board last reported about each card, keyed by task id. */
  taskSignals: ReadonlyMap<string, TaskCardSignal>;
  canMutateColumns: boolean;
  canMutateTasks: boolean;
  /** Once the stagger has played, columns render without the entrance animation. */
  entranceDone: boolean;
  dnd: BoardTaskDndController;
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  };
  onCreateColumn: () => void;
  onOpenColumnSettings: (column: ColumnDto) => void;
  onDeleteColumn: (column: ColumnDto) => void;
  onMoveColumn: (column: ColumnDto, direction: -1 | 1) => void;
  onTaskCreated: (task: TaskDto) => void;
}

/** The scrollable column strip and everything drag and drop needs around it. */
export function BoardCanvas({
  boardId,
  workspaceId,
  columns,
  tasksByColumn,
  selectedTaskId,
  taskSignals,
  canMutateColumns,
  canMutateTasks,
  entranceDone,
  dnd,
  accessibility,
  onCreateColumn,
  onOpenColumnSettings,
  onDeleteColumn,
  onMoveColumn,
  onTaskCreated,
}: BoardCanvasProps): React.ReactElement {
  const t = useTranslations('app.board');
  const reducedMotion = useReducedMotion();
  const [composerColumnId, setComposerColumnId] = useState<string | null>(null);
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);

  // Every column takes tasks from the same role check, so the first column is the first one a
  // task can be added to.
  const firstColumnId = columns[0]?.id ?? null;

  /**
   * `c` focuses the composer that is already open, wherever it is, and only opens the first
   * column's when none is: moving an open composer would throw away the title typed into it
   * (ADR 0035 §2). The nonce is what carries the focus, so the open composer is never
   * re-mounted and never loses what it holds.
   */
  const openOrFocusComposer = useCallback(() => {
    setComposerColumnId((current) =>
      current !== null && columns.some((column) => column.id === current) ? current : firstColumnId,
    );
    setComposerFocusNonce((current) => current + 1);
  }, [columns, firstColumnId]);
  const canAddTask = canMutateTasks && workspaceId !== null && firstColumnId !== null;
  useCreateTaskShortcut(canAddTask ? openOrFocusComposer : null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<BoardOverflow | null>(null);

  /**
   * The edge masks are CSS, hung on `data-overflow` below; what has to be measured is which
   * direction still holds a column. A scroll event alone is not enough: the strip also changes
   * shape when the window does, when the sidebar opens, and when a column is added or removed,
   * and none of those scroll it.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const measure = (): void => setOverflow(overflowOf(scroller));
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // jsdom has no ResizeObserver, and the server has no layout to observe.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [columns.length]);

  /**
   * Which column heading is the strip's single tab stop.
   *
   * docs/design.md §5: the board is a composite widget, so `Tab` reaches *a* column and keys
   * move between them from there. One heading at `tabIndex` 0 and the rest at -1 is that
   * sentence: an eight-column board costs the reader one tab stop, not eight. The index is
   * clamped at render, so deleting the last column cannot leave the strip with no tab stop.
   */
  const [currentColumn, setCurrentColumn] = useState(0);
  const currentColumnIndex = Math.min(currentColumn, Math.max(columns.length - 1, 0));

  /**
   * Home and End reach the first and last column, Ctrl plus an arrow the neighbouring one, and
   * the roving tab stop follows. Bare arrows are left alone on purpose, they belong to
   * @dnd-kit's keyboard drag and to the caret inside the composer. Meta is not a second binding
   * for this: Command plus an arrow is the browser's own history navigation on macOS.
   */
  const onHeadingKeyDown = useCallback((event: KeyboardEvent): void => {
    const scroller = scrollerRef.current;
    const target = event.target;
    if (scroller === null || !(target instanceof HTMLElement) || !target.matches(COLUMN_HEADING)) {
      return;
    }
    const headings = Array.from(scroller.querySelectorAll<HTMLElement>(COLUMN_HEADING));
    const index = headings.indexOf(target);
    if (index < 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'Home' && !event.ctrlKey) nextIndex = 0;
    else if (event.key === 'End' && !event.ctrlKey) nextIndex = headings.length - 1;
    else if (event.key === 'ArrowLeft' && event.ctrlKey) nextIndex = index - 1;
    else if (event.key === 'ArrowRight' && event.ctrlKey) nextIndex = index + 1;
    const next = nextIndex === undefined ? undefined : headings[nextIndex];
    if (next === undefined || nextIndex === undefined) return;

    // Home and End would otherwise take the strip to its own end without moving focus, leaving
    // the reader looking at a column their keyboard is not on.
    event.preventDefault();
    setCurrentColumn(nextIndex);
    // `preventScroll`, because `focus()` scrolls the heading just inside the scrollport with no
    // regard for `scroll-padding`: the first column would land at the strip's own 16px of
    // padding rather than at 0, which is a scroll position the edge mask reads as a column
    // hidden to the left. The `scrollIntoView` below honours it and is the only scroll here.
    next.focus({ preventScroll: true });
    // The column, not the heading. The heading sits 12px inside its column (the header's own
    // padding), so aligning the heading to the scroll padding would leave the column's leading
    // edge, and the focus outline drawn around the heading, under the 24px edge mask.
    (next.closest('section') ?? next).scrollIntoView({ block: 'nearest', inline: 'start' });
  }, []);

  /**
   * Focus arriving on a heading any other way, a click above all, moves the tab stop with it:
   * the tab stop has to be the column the reader is actually on, or Tab would take them back to
   * a column they left.
   */
  const onHeadingFocusIn = useCallback((event: FocusEvent): void => {
    const scroller = scrollerRef.current;
    const target = event.target;
    if (scroller === null || !(target instanceof HTMLElement) || !target.matches(COLUMN_HEADING)) {
      return;
    }
    const index = Array.from(scroller.querySelectorAll<HTMLElement>(COLUMN_HEADING)).indexOf(
      target,
    );
    if (index >= 0) setCurrentColumn(index);
  }, []);

  // Bound to the node rather than passed as React props: the strip is a scroll container, not a
  // control, and the keys below belong to the headings inside it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    scroller.addEventListener('keydown', onHeadingKeyDown);
    scroller.addEventListener('focusin', onHeadingFocusIn);
    return () => {
      scroller.removeEventListener('keydown', onHeadingKeyDown);
      scroller.removeEventListener('focusin', onHeadingFocusIn);
    };
  }, [onHeadingKeyDown, onHeadingFocusIn]);

  return (
    <DndContext
      accessibility={accessibility}
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      {/* The strip sits inside a positioned wrapper so the edge masks in `app/globals.css` can
          be drawn over its edges without scrolling away with the columns. */}
      <div
        data-slot="board-canvas"
        data-overflow={overflow ?? undefined}
        className="flex min-h-0 flex-1"
      >
        <div
          ref={scrollerRef}
          data-slot="board-scroller"
          // The snap comes off for the length of a drag: @dnd-kit carries a card across columns
          // by scrolling this strip itself, and a mandatory snap would pull each of those steps
          // back. It is an attribute rather than a `snap-none` utility because Tailwind emits
          // that one ahead of `snap-x` and it would lose; `app/globals.css` answers it.
          data-dragging={dnd.isDragging || undefined}
          // Below `md` a column is 85vw and the strip snaps, so a swipe always lands on one
          // column rather than between two. The scroll padding is not part of that and applies
          // at every width, because `scrollIntoView` reads it too: 16px matches the strip's own
          // padding below `md`, and 24px above it is the width of the edge mask, so a column
          // scrolled to the start sits clear of the mask rather than under it.
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto scroll-pl-4 p-4 max-md:snap-x max-md:snap-mandatory md:scroll-pl-6"
        >
          {columns.map((column, index) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={tasksByColumn.get(column.id) ?? []}
              boardId={boardId}
              selectedTaskId={selectedTaskId}
              taskSignals={taskSignals}
              canMutateColumns={canMutateColumns}
              canMutateTasks={canMutateTasks}
              headingTabbable={index === currentColumnIndex}
              canMoveLeft={index > 0}
              canMoveRight={index < columns.length - 1}
              onOpenSettings={() => onOpenColumnSettings(column)}
              onDelete={() => onDeleteColumn(column)}
              onMoveLeft={() => onMoveColumn(column, -1)}
              onMoveRight={() => onMoveColumn(column, 1)}
              workspaceId={workspaceId}
              composerOpen={composerColumnId === column.id}
              composerFocusNonce={composerFocusNonce}
              onComposerOpenChange={(open) => setComposerColumnId(open ? column.id : null)}
              onTaskCreated={onTaskCreated}
              // A number rather than the indicator object, so a column that is not the target is
              // handed a prop equal in value for the whole drag instead of a fresh object each
              // time. How often that happens at all is bounded by @dnd-kit, which raises
              // `onDragOver` from an effect keyed on the over id rather than per pointer event.
              dropIndicatorIndex={
                dnd.dropIndicator?.columnId === column.id ? dnd.dropIndicator.index : null
              }
              className={entranceDone ? undefined : 'board-column-enter'}
              style={
                entranceDone ? undefined : ({ '--stagger-index': index } as React.CSSProperties)
              }
            />
          ))}
          {canMutateColumns ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-[var(--column-width)] min-w-[280px] shrink-0 max-md:min-w-0 max-md:snap-start"
              onClick={onCreateColumn}
            >
              <Plus />
              {t('column.createAction')}
            </Button>
          ) : null}
        </div>
      </div>
      {/* @dnd-kit flies the overlay back to the drop position with `node.animate()`, a Web
          Animations API call the reduced-motion block in `app/globals.css` cannot reach: the
          browser pass measured a 250ms `translate3d` keyframe pair still running under
          `prefers-reduced-motion: reduce`. `null` is @dnd-kit's own way to say the overlay
          simply goes away, which is the movement-free landing docs/design.md §5 asks for. */}
      <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation}>
        {dnd.activeTask ? <TaskDragPreview task={dnd.activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
