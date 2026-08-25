'use client';

import { useEffect, useRef } from 'react';

export type UseTaskPanelFocusOptions = {
  /** Re-runs the opener capture when the panel switches task. */
  taskId: string | undefined;
  /** Escape, and the 404 save path, both leave through here. */
  onClose: () => void;
};

export type UseTaskPanelFocusResult = {
  panelRef: React.RefObject<HTMLElement | null>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

/**
 * The overlay surfaces `components/ui/dialog.tsx` marks while they are open.
 *
 * Read from the DOM rather than from a counter the layers keep between them: Radix already
 * writes `data-state` on the content it mounts, so there is no second copy of the truth to
 * fall out of step with it, and nothing to reset when a layer unmounts without closing.
 */
const OPEN_LAYER_SELECTOR =
  '[data-slot="dialog-content"][data-state="open"], [data-slot="dialog-drawer-content"][data-state="open"]';

/**
 * The dialog behaviour the task panel has to hand-roll.
 *
 * The panel is a plain `<aside>` behind a route segment, not a Radix dialog, so nothing gives
 * it a focus scope, a dismiss layer or a focus return. Radix `FocusScope` covers the dialogs
 * in `form-dialog.tsx`; the same three jobs are done here by hand, in one place, because they
 * are one concern (keyboard containment) rather than three unrelated effects sitting in the
 * middle of the panel's render.
 */
export function useTaskPanelFocus({
  taskId,
  onClose,
}: UseTaskPanelFocusOptions): UseTaskPanelFocusResult {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);

  // Closing only takes focus back if the user still has it in here. Tracked from `focusin`
  // rather than read on the way out: by the time the unmount cleanup runs, React has already
  // detached the panel and the browser has already reset `document.activeElement`.
  useEffect(() => {
    function onFocusIn(event: FocusEvent): void {
      const target = event.target;
      focusInsideRef.current =
        target instanceof Node && (panelRef.current?.contains(target) ?? false);
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Below `md` the panel is a fullscreen sheet (`fixed inset-0`). Without a focus trap, Tab
  // walks onto the board underneath. Desktop keeps the panel in the layout flow, so the
  // ordinary document tab order is correct there.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !media.matches) return;
      // A layer above the panel owns the key, for the same reason it owns `Esc` below. Without
      // this, Radix's own `FocusScope` moves focus into the dialog and the trap below reads
      // that as focus having escaped the panel, hauls it back, and Tab stops advancing inside
      // the dialog: a keyboard trap (WCAG 2.1.2).
      if (event.defaultPrevented || document.querySelector(OPEN_LAYER_SELECTOR)) return;
      const root = panelRef.current;
      if (!root) return;

      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active instanceof Node && !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    // Recorded before focus moves into the panel — nothing else in the tree knows which card
    // opened it. Anything already inside is the panel's own doing (a task loading in
    // underneath it), never a place worth returning to, and `<body>` is the lost-focus state
    // this is here to avoid rather than a target to restore.
    const opener = document.activeElement;
    if (
      opener instanceof HTMLElement &&
      opener !== document.body &&
      !panelRef.current?.contains(opener)
    ) {
      openerRef.current = opener;
    }
    headingRef.current?.focus();
    focusInsideRef.current = panelRef.current?.contains(document.activeElement) ?? false;
  }, [taskId]);

  // Nothing hands focus back when the route drops the panel: React removes the focused node
  // and the browser resets focus to `<body>`, dumping a keyboard user at the top of the
  // document. So the return is done on unmount, by hand.
  useEffect(() => {
    return () => {
      if (!focusInsideRef.current) return;

      const opener = openerRef.current;
      if (opener?.isConnected) {
        opener.focus();
        if (document.activeElement === opener) return;
      }

      // The opener is regularly gone by now — the task was deleted, filtered out of the
      // board, or moved by another client. The board's landmark keeps focus on the page and
      // the tab order roughly where the user was, instead of back at `<body>`. It is not
      // focusable on its own, so it is lent a tabindex for exactly this one focus.
      const main = document.querySelector('main');
      if (!main) return;
      if (!main.hasAttribute('tabindex')) {
        main.setAttribute('tabindex', '-1');
        main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
      }
      main.focus();
    };
  }, []);

  // `Esc` closes the topmost layer only (docs/design.md §5). This listener is on `window`, the
  // last stop of every keystroke in the document, so it sees the presses the layers above the
  // panel have already dealt with: the delete confirmation dismisses itself from a `document`
  // listener in the capture phase, and the mention picker from a React handler on the composer.
  // `defaultPrevented` is what both of them say so with; a modal dialog is recognised on top of
  // that, because a layer that covers the panel owns the key whether or not it marks the event.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return { panelRef, headingRef };
}
