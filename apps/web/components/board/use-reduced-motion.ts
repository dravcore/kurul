'use client';

import { useEffect, useState } from 'react';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the reader has asked for reduced motion.
 *
 * Every other answer to that question in this app is written in CSS, which is where it belongs
 * (`app/globals.css` carries a reduced twin beside each keyframe). This hook exists for the one
 * case CSS cannot reach: `@dnd-kit/core` plays the drag overlay's drop with the Web Animations
 * API (`dragOverlay.node.animate(...)`), and a media query has no say over an animation a
 * script created. Reading the same query in JS is the only way that one keeps the promise
 * docs/design.md §5 makes for all the others.
 *
 * `false` until the first effect runs, and `false` for good where `matchMedia` does not exist
 * (server render, jsdom): the server has no preference to read, so the first client render has
 * to match the markup it sent rather than guess.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(REDUCE_QUERY);
    const sync = (): void => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return reduced;
}
