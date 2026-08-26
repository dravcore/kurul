'use client';

import { useEffect } from 'react';

/**
 * `c` opens the board's first task composer (ADR 0035, the letter docs/design.md §5 reserves).
 *
 * Same guard shape as the `/` filter shortcut in `board-filter-search.tsx`: a modified `c` and a
 * `c` typed into a field are letters rather than shortcuts, and a `c` inside an open dialog
 * belongs to whatever that dialog is doing.
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
          target.closest('[role="dialog"]') !== null)
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
