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

export interface UseApiResourceOptions {
  /**
   * Called on a failed load, in the same pass that sets `error` — for screens that report a
   * failure as a toast rather than in place. Never called for an aborted request, and it
   * does not have to be referentially stable.
   */
  onError?: (caught: unknown) => void;
  /**
   * Keep the last value that loaded when a later load fails, instead of clearing it.
   *
   * Off by default, for the reason in the reset branch below. Turn it on for a value that is
   * re-fetched on a timer and rendered without an error surface of its own: an unread badge
   * that blanks to zero because one poll failed is a worse lie than one showing the count
   * from two minutes ago, and there is nowhere on a bell icon to say which it is.
   */
  keepStaleOnError?: boolean;
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
  options?: UseApiResourceOptions,
): ApiResource<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const keepStaleOnError = options?.keepStaleOnError ?? false;

  // Captured once: callers pass a fresh `[]` every render, which would otherwise make the
  // reset-on-failure path a new dependency on every commit.
  const initialDataRef = useRef(initialData);

  // Held in a ref rather than a dependency: an inline `onError` closure is a new function on
  // every render, and depending on it would refetch the whole resource on every commit.
  const onErrorRef = useRef(options?.onError);
  useEffect(() => {
    onErrorRef.current = options?.onError;
  });

  useEffect(() => {
    if (!fetcher) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const next = await fetcher(controller.signal);
        if (!controller.signal.aborted) setData(next);
      } catch (caught) {
        if (!controller.signal.aborted) {
          // Stale rows next to an error message read as current data — drop them, unless the
          // caller said the last value is worth more than a blank (`keepStaleOnError`).
          if (!keepStaleOnError) setData(initialDataRef.current);
          setError(errorMessage);
          onErrorRef.current?.(caught);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [fetcher, errorMessage, reloadCount, keepStaleOnError]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { data, loading, error, reload, setData };
}

/**
 * A `useState`-shaped setter for one field of a resource loaded as a single object.
 *
 * A screen that loads four lists in one round of requests holds them as one `T` — that is
 * what makes them one abort, one loading flag and one error. The parts still need to be
 * edited on their own afterwards (a posted comment, a created label), and the alternative is
 * mirroring each field back into its own `useState`, which reintroduces exactly the
 * two-sources-of-truth problem the single fetch removed.
 *
 * Stable as long as `setData` and `key` are, so it is safe in an effect dependency list.
 */
export function useResourceField<T, K extends keyof T>(
  setData: Dispatch<SetStateAction<T>>,
  key: K,
): Dispatch<SetStateAction<T[K]>> {
  return useCallback(
    (action: SetStateAction<T[K]>) => {
      setData((current) => ({
        ...current,
        [key]:
          typeof action === 'function'
            ? (action as (previous: T[K]) => T[K])(current[key])
            : action,
      }));
    },
    [setData, key],
  );
}
