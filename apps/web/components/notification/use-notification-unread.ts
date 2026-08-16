'use client';

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import type { NotificationUnreadCountDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { usePollFallback } from '@/lib/use-poll-fallback';

/**
 * How often the count is re-read **while the notification room is not joined**.
 *
 * Two minutes is a compromise, not a target: the badge is push-driven and a connected bell
 * asks for nothing at all, so this interval only ever runs in a state that should be rare.
 */
const FALLBACK_POLL_MS = 120_000;

export interface UseNotificationUnreadOptions {
  workspaceId: string | null;
  /** The shell knows which workspace it is in. Nothing is read before that. */
  enabled: boolean;
  /** The notification room is joined, so the count arrives by push and needs no timer. */
  connected: boolean;
  /** Bumped by the bell when the socket says the count moved. */
  refreshKey: number;
}

export interface NotificationUnread {
  count: number;
  /** Local correction after a read/mark-all, without a round trip. */
  setCount: Dispatch<SetStateAction<number>>;
}

/**
 * The unread count behind the bell's badge.
 *
 * Owns one number and everything that keeps it honest: the read itself, the refresh a dropped
 * room calls for, and the fallback poll that covers a socket that never comes back. The count
 * is deliberately kept when a refresh fails — a badge has nowhere to print "this failed", so
 * blanking it to zero would say "nothing unread", which is the one thing it must not say
 * wrongly.
 *
 * The socket lives in the bell, not here: it also drives the dropdown's rows, and two
 * subscriptions to the same room would double every join. So `connected` and `refreshKey`
 * arrive as props — the room's state and its signal, respectively.
 */
export function useNotificationUnread({
  workspaceId,
  enabled,
  connected,
  refreshKey,
}: UseNotificationUnreadOptions): NotificationUnread {
  const t = useTranslations('app.notifications');

  const fetchUnread = useMemo(
    () =>
      enabled && workspaceId
        ? (signal: AbortSignal): Promise<number> =>
            api
              .get<NotificationUnreadCountDto>(
                `/workspaces/${workspaceId}/notifications/unread-count`,
                { signal },
              )
              .then((result) => result.count)
        : null,
    // `refreshKey` is not read by the loader — it is a dependency because the resource
    // reloads when the fetcher's identity changes, which is how a bump becomes a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, workspaceId, refreshKey],
  );

  const {
    data: count,
    reload,
    setData: setCount,
  } = useApiResource<number>(
    fetchUnread,
    0,
    // Held for the hook's shape; nothing renders it, for the reason in the docstring above.
    t('loadError'),
    { keepStaleOnError: true },
  );

  // Distinguishes "never joined" — where the resource's own first load already covers the
  // badge — from "was joined and then dropped", which is the transition that opens a gap.
  const roomWasJoinedRef = useRef(false);
  useEffect(() => {
    if (connected) {
      roomWasJoinedRef.current = true;
      return;
    }
    if (roomWasJoinedRef.current) {
      roomWasJoinedRef.current = false;
      reload();
    }
  }, [connected, reload]);

  usePollFallback(reload, {
    enabled: enabled && Boolean(workspaceId) && !connected,
    intervalMs: FALLBACK_POLL_MS,
  });

  return { count, setCount };
}
