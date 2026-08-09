'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * SancakRail draws a purely visual, `aria-hidden` position indicator that
 * tracks whichever element in the container is marked `data-rail-active="true"`.
 * Callers must pair `data-rail-active` with `aria-current` (or an equivalent
 * programmatic active state) and guarantee at most one active element per
 * container.
 */
export interface SancakRailBox {
  top: number;
  height: number;
}

export function useSancakRail(
  containerRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): SancakRailBox | null {
  const [box, setBox] = useState<SancakRailBox | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-rail-active="true"]');
    if (!active) {
      setBox(null);
      return;
    }
    setBox({ top: active.offsetTop + 6, height: active.offsetHeight - 12 });
    // Positions depend on layout, not props; callers pass what changes layout.
  }, deps);

  return box;
}

export function SancakRail({
  box,
}: Readonly<{ box: SancakRailBox | null }>): React.ReactElement | null {
  if (!box) return null;
  return (
    <span
      aria-hidden
      className="absolute left-0 z-10 w-0.5 rounded-full bg-signature transition-[transform,height] duration-150 ease-[var(--ease-out)]"
      style={{ height: box.height, transform: `translateY(${box.top}px)` }}
    />
  );
}
