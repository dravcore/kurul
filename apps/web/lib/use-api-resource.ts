'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export interface ApiResource<T> {
  data: T;
  loading: boolean;
  /** The caller's message, set on any failure; `null` while the last load succeeded. */
  error: string | null;
  /** Refetch without remounting — for a retry button or an external change. */
  reload: () => void;
  /** Local edits (optimistic insert, remove) without a round trip. */
  setData: Dispatch<SetStateAction<T>>;
}

/**
 * Loads a read-only API resource into component state.
 *
 * Every list screen was repeating the same four moving parts — an `AbortController`, a
 * loading flag, an error string and an `if (signal.aborted)` guard around each `setState`
 * — and the guard is the one that is easy to forget: without it a workspace switch races
 * its own unmount and writes the previous workspace's rows into the new view.
 *
 * `fetcher` must be referentially stable (wrap it in `useCallback`); it is the dependency
 * that decides when a reload happens. Pass `null` to hold off entirely, which is what a
 * screen does before it knows its workspace id.
 */
export function useApiResource<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  initialData: T,
  errorMessage: string,
): ApiResource<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Captured once: callers pass a fresh `[]` every render, which would otherwise make the
  // reset-on-failure path a new dependency on every commit.
  const initialDataRef = useRef(initialData);

  useEffect(() => {
    if (!fetcher) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const next = await fetcher(controller.signal);
        if (!controller.signal.aborted) setData(next);
      } catch {
        if (!controller.signal.aborted) {
          // Stale rows next to an error message read as current data — drop them.
          setData(initialDataRef.current);
          setError(errorMessage);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [fetcher, errorMessage, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { data, loading, error, reload, setData };
}
