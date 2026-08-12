import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePollFallback } from './use-poll-fallback';

const INTERVAL = 120_000;

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('usePollFallback', () => {
  it('refreshes on the interval while enabled', () => {
    const refresh = vi.fn();
    renderHook(() => usePollFallback(refresh, { enabled: true, intervalMs: INTERVAL }));

    // Nothing on mount: the value's own first load is not this hook's job.
    expect(refresh).not.toHaveBeenCalled();

    advance(INTERVAL);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(INTERVAL);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  /** The whole point of a fallback: a live push channel must cost no periodic requests. */
  it('holds no timer at all while disabled', () => {
    const refresh = vi.fn();
    renderHook(() => usePollFallback(refresh, { enabled: false, intervalMs: INTERVAL }));

    advance(INTERVAL * 5);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('starts and stops as enabled flips', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePollFallback(refresh, { enabled, intervalMs: INTERVAL }),
      { initialProps: { enabled: false } },
    );

    rerender({ enabled: true });
    advance(INTERVAL);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    advance(INTERVAL * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops in a hidden tab and refreshes once when it comes back', () => {
    const refresh = vi.fn();
    renderHook(() => usePollFallback(refresh, { enabled: true, intervalMs: INTERVAL }));

    setVisibility('hidden');
    advance(INTERVAL * 3);
    expect(refresh).not.toHaveBeenCalled();

    // Immediately, so what the tab shows on the frame it is read is never INTERVAL stale.
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);

    advance(INTERVAL);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('clears its timer and listener on unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() =>
      usePollFallback(refresh, { enabled: true, intervalMs: INTERVAL }),
    );

    unmount();

    advance(INTERVAL * 3);
    setVisibility('visible');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('always calls the newest refresh without restarting the timer', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ refresh }: { refresh: () => void }) =>
        usePollFallback(refresh, { enabled: true, intervalMs: INTERVAL }),
      { initialProps: { refresh: first } },
    );

    advance(INTERVAL / 2);
    rerender({ refresh: second });
    advance(INTERVAL / 2);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
