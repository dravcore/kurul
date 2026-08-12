'use client';

import { useEffect, useRef } from 'react';

export interface UsePollFallbackOptions {
  /** Off while the push channel is live; the timer only exists to cover its absence. */
  enabled: boolean;
  intervalMs: number;
}

/**
 * Periodically refreshes something while its realtime channel is down.
 *
 * A push-driven value has one blind spot: the channel's own absence. A proxy that drops
 * WebSockets, or the minutes of backoff a reconnect spends, would otherwise leave the value
 * frozen with nothing on screen saying so — worse than one request every couple of minutes in
 * a state that should be rare. So this is deliberately a *fallback*: it holds no timer at all
 * while `enabled` is false, and a connected screen issues no periodic requests.
 *
 * A hidden tab stops polling too — nobody is looking — and refreshes once the moment it comes
 * back, so what it shows is never up to `intervalMs` out of date on the frame it is read.
 *
 * `refresh` must be referentially stable; an unstable one restarts the timer on every commit.
 */
export function usePollFallback(
  refresh: () => void,
  { enabled, intervalMs }: UsePollFallbackOptions,
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;
    const start = (): void => {
      if (timer !== null) return;
      timer = window.setInterval(() => refreshRef.current(), intervalMs);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      refreshRef.current();
      start();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
