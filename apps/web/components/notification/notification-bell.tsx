'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { notificationTitle } from '@/lib/notification-copy';
import { markAllNotificationsRead, openNotificationTarget } from '@/lib/notification-actions';
import { formatRelativeTime } from '@/lib/relative-time';
import { useApiResource } from '@/lib/use-api-resource';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { useNotificationSocket } from './use-notification-socket';
import { toast } from 'sonner';

/**
 * Fallback refresh interval, used **only while the notification room is not joined**.
 *
 * The badge is push-driven: the server signals the recipient's room whenever their unread
 * count moves, and every (re)join answers with a full refresh, so a connected bell never
 * polls. What the socket cannot cover is its own absence — a proxy that drops WebSockets, or
 * the ~4 minutes of backoff plus a 60s cooldown that `lib/socket.ts` spends before it tries
 * again. Removing the timer outright would leave the badge frozen for the whole of that
 * window with nothing on screen saying so, which is worse than one request every two minutes
 * in a state that should be rare.
 */
const FALLBACK_POLL_MS = 120_000;

/** Stable identity so the closed dropdown does not reset its rows on every render. */
const EMPTY_ITEMS: NotificationDto[] = [];

export function NotificationBell(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const locale = useLocale();
  const router = useRouter();
  const { activeId: workspaceId, bootstrapped } = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Only fetched while the dropdown is open — a closed bell needs the badge, not the rows.
  const fetchItems = useMemo(
    () =>
      open && workspaceId
        ? (signal: AbortSignal) =>
            api
              .get<CursorPage<NotificationDto>>(
                `/workspaces/${workspaceId}/notifications?limit=20`,
                { signal },
              )
              .then((page) => page.items)
        : null,
    [open, workspaceId],
  );
  const {
    data: items,
    loading: loadingList,
    error: listError,
    reload: reloadItems,
    setData: setItems,
  } = useApiResource<NotificationDto[]>(fetchItems, EMPTY_ITEMS, t('loadError'));

  const refreshUnread = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!workspaceId) return;
      try {
        const result = await api.get<NotificationUnreadCountDto>(
          `/workspaces/${workspaceId}/notifications/unread-count`,
          { signal },
        );
        if (!signal?.aborted) {
          setUnreadCount(result.count);
        }
      } catch {
        // Keep last known count; avoid toast spam on poll.
      }
    },
    [workspaceId],
  );

  // Rows only matter while the dropdown is open; the badge is refreshed either way.
  const refreshOpenViews = useCallback((): void => {
    void refreshUnread();
    if (open) reloadItems();
  }, [open, refreshUnread, reloadItems]);

  const { connected } = useNotificationSocket(workspaceId, bootstrapped, {
    onUnreadChanged: refreshOpenViews,
    // A (re)join replays nothing, so the first thing after it is a full refresh — that is what
    // closes the gap a disconnection opened.
    onResync: refreshOpenViews,
  });

  useEffect(() => {
    // The socket is the primary channel; this effect is the fallback and stays unmounted
    // while the room is joined, so a live bell issues no periodic requests at all.
    if (!bootstrapped || !workspaceId || connected) return;
    const controller = new AbortController();
    void refreshUnread(controller.signal);

    let timer: number | null = null;
    const startPolling = (): void => {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        void refreshUnread();
      }, FALLBACK_POLL_MS);
    };
    const stopPolling = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    // Still worth keeping, now that it guards the fallback only: a hidden tab whose socket is
    // down has nobody looking at its badge, so it should not keep asking for it either.
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        // Refresh once immediately so a badge that went stale in a background tab is never
        // shown for up to FALLBACK_POLL_MS after the tab is looked at again.
        void refreshUnread();
        startPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      controller.abort();
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [bootstrapped, workspaceId, refreshUnread, connected]);

  async function markAllRead(): Promise<void> {
    if (!workspaceId) return;
    try {
      await markAllNotificationsRead(workspaceId);
      setItems((current) =>
        current.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch {
      toast.error(t('markReadError'));
    }
  }

  async function openNotification(notification: NotificationDto): Promise<void> {
    if (!workspaceId) return;
    try {
      const { navigated, updated } = await openNotificationTarget(
        workspaceId,
        notification,
        router,
      );
      if (updated) {
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
      setOpen(false);
      if (notification.taskId && !navigated) {
        toast.error(t('openTaskError'));
      }
    } catch {
      toast.error(t('markReadError'));
      setOpen(false);
    }
  }

  const badgeLabel =
    unreadCount > 99 ? t('badgeOverflow') : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('open')}
          className="relative"
        >
          <Bell className="size-4" />
          {badgeLabel ? (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-sm)] bg-signature px-0.5 text-[10px] font-medium text-white',
              )}
            >
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0">{t('title')}</DropdownMenuLabel>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            {t('markAllRead')}
          </Button>
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-80 overflow-y-auto py-1">
          {loadingList ? (
            <p className="px-3 py-4 text-small text-muted-foreground">{t('loading')}</p>
          ) : listError ? (
            // Reported here rather than as a toast: the load clears the rows, and an empty
            // "You're caught up" is the one thing this must not say after a failure.
            <p className="px-3 py-4 text-small text-destructive">{listError}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-small text-muted-foreground">{t('empty')}</p>
          ) : (
            items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className={cn(
                  'flex cursor-pointer flex-col items-start gap-0.5 rounded-none px-3 py-2',
                  !item.readAt && 'bg-signature-subtle/40',
                )}
                onSelect={(event) => {
                  event.preventDefault();
                  void openNotification(item);
                }}
              >
                <span className="text-body text-foreground">{notificationTitle(item, t)}</span>
                <time
                  className="text-micro text-muted-foreground"
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toISOString()}
                >
                  {formatRelativeTime(item.createdAt, locale)}
                </time>
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={() => {
              setOpen(false);
              router.push('/notifications');
            }}
          >
            {t('viewAll')}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
