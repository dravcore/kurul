import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useReducedMotion } from './use-reduced-motion';

type Listener = (event: MediaQueryListEvent) => void;

/** A `matchMedia` double that answers `matches` and can flip it on the registered listeners,
 * which is the whole of what this hook uses. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const list = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn((_: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: Listener) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => list);
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return {
    list,
    matchMedia,
    change(next: boolean): void {
      list.matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  // jsdom implements no `matchMedia` at all, so putting the property back is not enough: the
  // absence is itself a case this hook handles and the next test has to see it.
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

describe('useReducedMotion', () => {
  it('reports the preference the media query already holds', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reports false while the reader has asked for nothing', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('follows the preference changing while the page is open', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.change(true));
    expect(result.current).toBe(true);

    act(() => media.change(false));
    expect(result.current).toBe(false);
  });

  it('drops its listener on unmount', () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.list.addEventListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(media.list.removeEventListener).toHaveBeenCalledTimes(1);
  });

  // Server render and jsdom both land here. Reporting `false` rather than throwing is what
  // keeps the first client render identical to the markup the server sent.
  it('reports false where matchMedia does not exist at all', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
