'use client';

import { useEffect } from 'react';

/** The panel `components/task/task-panel.tsx` renders, which is a full-screen layer below `md`. */
const TASK_PANEL = '[data-slot="task-panel"]';

/**
 * Tailwind's `md` breakpoint, as the media query the panel's own `md:static` compiles from.
 *
 * `width < 48rem` and not `max-width: 767px`: the two disagree for anyone whose root font size
 * is not 16px, which would put this query and the utilities it mirrors on different sides of
 * the same breakpoint (`app/globals.css` makes the same point about `--topbar-height`). Shared
 * with `components/task/use-task-panel-focus.ts`, which arms the panel's Tab trap at exactly
 * the width the panel becomes a fullscreen sheet.
 */
export const BELOW_MD = '(width < 48rem)';

/**
 * `c` opens the board's first task composer (ADR 0035, the letter docs/design.md §5 reserves).
 *
 * Same guard shape as the `/` filter shortcut in `board-filter-search.tsx`: a modified `c` and a
 * `c` typed into a field are letters rather than shortcuts, and a `c` inside an open dialog
 * belongs to whatever that dialog is doing.
 *
 * The task panel is the fourth guard, in two parts. It is an `<aside>` and not a dialog, so the
 * `role="dialog"` test above never sees it, yet a `c` pressed on one of its buttons belongs to
 * the task being read and not to a column behind it. And below `md` the panel is `fixed inset-0`
 * over the whole board: opening a composer there would put the caret in a field nobody can see,
 * which is why a mounted panel unarms the key at that width whatever the key was pressed on.
 *
 * `onTrigger` is null for a board with nothing to add a task to, which is what unarms the key.
 */
export function useCreateTaskShortcut(onTrigger: (() => void) | null): void {
  useEffect(() => {
    const trigger = onTrigger;
    if (trigger === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]') !== null ||
          target.closest(TASK_PANEL) !== null)
      ) {
        return;
      }
      // `matchMedia` is absent in jsdom and in any renderer without it, and a width nothing can
      // measure is not a width at which the panel is covering the board.
      if (
        document.querySelector(TASK_PANEL) !== null &&
        window.matchMedia?.(BELOW_MD).matches === true
      ) {
        return;
      }
      event.preventDefault();
      trigger();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onTrigger]);
}
