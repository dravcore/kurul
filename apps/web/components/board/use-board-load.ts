'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import { apiStatus } from '@/lib/api';
import type { BoardTaskFilters } from '@/lib/task-query';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';

export type UseBoardLoadOptions = {
  boardId: string;
  filters: BoardTaskFilters;
  reloadBoardMeta: (signal?: AbortSignal) => Promise<void>;
  drainTasks: (signal?: AbortSignal, onFirstPage?: () => void) => Promise<void>;
  reloadTasks: (signal?: AbortSignal) => Promise<void>;
};

export type UseBoardLoadResult = {
  loading: boolean;
  error: string | null;
  /**
   * The last board load failed with 404/403: the board is not there, or not ours. There is
   * nothing to retry, so the caller must offer a way out instead of a `Try again` button.
   */
  unavailable: boolean;
  /**
   * Runs the initial load again from a failed state: clears the error, puts the skeleton back
   * and re-enters the effect below.
   */
  retry: () => void;
  /**
   * Drops the failure without touching the skeleton, for a resync that has already produced
   * fresher data. Separate from `retry` for the reason in `useBoardData`'s `reload`.
   */
  clearFailure: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

/**
 * The board's load status: when the skeleton is up, what a failure means, and how to ask again.
 *
 * The board load stays on a hand-rolled controller rather than `useApiResource`.
 *
 * The hook models one value arriving once: a single `T`, set when the promise resolves.
 * This load is five values arriving at three different times — the frame (board, columns,
 * members, labels) and the first task page together decide when the skeleton comes down,
 * while the remaining pages keep streaming into the same `tasks` array behind an already
 * painted board. There is no `T` whose single assignment expresses that, and folding the
 * pages into one resolved value would put the skeleton back up until the last page landed,
 * which is the regression this streaming shape exists to avoid.
 */
export function useBoardLoad({
  boardId,
  filters,
  reloadBoardMeta,
  drainTasks,
  reloadTasks,
}: UseBoardLoadOptions): UseBoardLoadResult {
  const t = useTranslations('app.board');
  const { activeId } = useWorkspaceContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  /** Bumped by `retry`; part of the load effect's deps, which is what re-runs it. */
  const [retryToken, setRetryToken] = useState(0);
  const loadedBoardIdRef = useRef<string | null>(null);

  /**
   * Put the load status back the moment the request changes, during render rather than at the
   * top of the effect below.
   *
   * The effect used to open with `setLoading(true)` / `setError(null)`, which cost a second
   * render every time the board or the filters changed and left one frame in between showing
   * the *previous* request's error over a board that was already being replaced.
   *
   * The skeleton comes back only for a board that is not on screen: a new board, or a retry
   * after the last attempt at this one failed — which is what `error !== null` says, and is
   * the same condition as the `loadedBoardIdRef` miss the effect used to test. A filter change
   * on a board that did paint keeps it painted while the tasks re-drain behind it.
   */
  const [syncedRequest, setSyncedRequest] = useState({ activeId, boardId, filters });
  if (
    activeId &&
    (syncedRequest.activeId !== activeId ||
      syncedRequest.boardId !== boardId ||
      syncedRequest.filters !== filters)
  ) {
    const isNewBoard = syncedRequest.activeId !== activeId || syncedRequest.boardId !== boardId;
    setSyncedRequest({ activeId, boardId, filters });
    if (isNewBoard || error !== null) setLoading(true);
    setError(null);
    setUnavailable(false);
  }

  const clearFailure = useCallback((): void => {
    setError(null);
    setUnavailable(false);
  }, []);

  /**
   * The way back from the error screen.
   *
   * `clearFailure` drops the same failure on a successful resync, but deliberately does
   * nothing else: it is what runs behind a board that is already on screen, where putting the
   * skeleton back on every reconnect would be the regression. So retrying is its own path —
   * clear the failure, put the skeleton back, forget that this board ever loaded (so the
   * effect takes the *initial* branch and re-reads the frame, not just the tasks) and bump the
   * token the effect is keyed on.
   *
   * Returns `void` rather than a promise on purpose: the awaiting happens inside the effect,
   * which already has the catch. A caller wiring this to a button cannot leave a rejection
   * unhandled.
   */
  const retry = useCallback((): void => {
    loadedBoardIdRef.current = null;
    setError(null);
    setUnavailable(false);
    setLoading(true);
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const isInitial = loadedBoardIdRef.current !== boardId;
    void (async () => {
      const reveal = (): void => {
        if (!controller.signal.aborted) setLoading(false);
      };
      try {
        if (isInitial) {
          let firstPageArrived = (): void => {};
          const firstPage = new Promise<void>((resolve) => {
            firstPageArrived = resolve;
          });
          const metaDone = reloadBoardMeta(controller.signal);
          const tasksDone = drainTasks(controller.signal, firstPageArrived);
          // The frame (columns) plus the first page is enough to paint the board; the
          // remaining pages stream in behind it instead of holding the skeleton up.
          void Promise.all([metaDone, firstPage]).then(reveal, () => {
            // Failure is reported by the await below.
          });
          await Promise.all([metaDone, tasksDone]);
        } else {
          await reloadTasks(controller.signal);
        }
        if (!controller.signal.aborted) {
          loadedBoardIdRef.current = boardId;
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          // 404 and 403 are answers, not outages: the board is gone, or it was never ours.
          // Retrying re-asks a question the server has already settled, so they get their own
          // message and the caller drops the retry control.
          const status = apiStatus(caught);
          const gone = status === 404 || status === 403;
          setUnavailable(gone);
          setError(gone ? t('unavailable') : t('loadError'));
        }
      } finally {
        reveal();
      }
    })();
    return () => controller.abort();
  }, [activeId, boardId, filters, retryToken, drainTasks, reloadBoardMeta, reloadTasks, t]);

  return { loading, error, unavailable, retry, clearFailure, setLoading, setError };
}
