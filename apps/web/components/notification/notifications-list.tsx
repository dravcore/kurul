'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { NotificationType, type CursorPage, type NotificationDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { notificationTitle } from '@/lib/notification-copy';
import { markAllNotificationsRead, openNotificationTarget } from '@/lib/notification-actions';
import { formatRelativeTime } from '@/lib/relative-time';
import { useApiResource } from '@/lib/use-api-resource';
import { cn } from '@/lib/utils';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotificationUnreadContext } from './notification-unread-provider';
import { useNotificationSocket } from './use-notification-socket';
import { toast } from 'sonner';

const PAGE_LIMIT = 50;

const EMPTY_PAGE: CursorPage<NotificationDto> = { items: [], nextCursor: null };

type TypeFilter = '' | (typeof NotificationType)[keyof typeof NotificationType];

export function NotificationsList(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const tErrors = useTranslations('app.errors');
  const locale = useLocale();
  const router = useRouter();
  const { activeId: workspaceId } = useWorkspaceContext();
  const { setCount: setUnreadCount } = useNotificationUnreadContext();

  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');

  const buildQuery = useCallback(
    (cursor?: string | null): string => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      if (unreadOnly) params.set('unreadOnly', 'true');
      if (typeFilter) params.set('type', typeFilter);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [typeFilter, unreadOnly],
  );

  // The whole page is the resource, not just its rows: `nextCursor` has to move with the
  // items it was issued for, or "load more" pages off a filter the user already changed.
  const fetchPage = useMemo(
    () =>
      workspaceId
        ? (signal: AbortSignal) =>
            api.get<CursorPage<NotificationDto>>(
              `/workspaces/${workspaceId}/notifications?${buildQuery()}`,
              { signal },
            )
        : null,
    [workspaceId, buildQuery],
  );
  const {
    data: page,
    loading,
    error,
    reload,
    setData: setPage,
  } = useApiResource<CursorPage<NotificationDto>>(fetchPage, EMPTY_PAGE, t('loadError'));
  const { items, nextCursor } = page;

  // The same signal the bell listens to. Reloading the first page is the whole response: the
  // event carries no notification, and this screen shows rows the API has to render anyway.
  const reloadFromSignal = useCallback((): void => {
    // A reload mid-`loadMore` would be overwritten by the append that is already in flight.
    if (!loadingMore) reload();
  }, [loadingMore, reload]);

  // The first join lands right after the initial load, which already has fresh rows; only a
  // later one (a reconnect) is telling us something we missed.
  const joinedOnce = useRef(false);
  const onResync = useCallback((): void => {
    if (!joinedOnce.current) {
      joinedOnce.current = true;
      return;
    }
    reloadFromSignal();
  }, [reloadFromSignal]);

  useNotificationSocket(workspaceId, true, {
    onUnreadChanged: reloadFromSignal,
    onResync,
  });

  const setItems = useCallback(
    (update: (current: NotificationDto[]) => NotificationDto[]): void => {
      setPage((current) => ({ ...current, items: update(current.items) }));
    },
    [setPage],
  );

  async function loadMore(): Promise<void> {
    if (!workspaceId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.get<CursorPage<NotificationDto>>(
        `/workspaces/${workspaceId}/notifications?${buildQuery(nextCursor)}`,
      );
      setPage((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead(): Promise<void> {
    if (!workspaceId) return;
    try {
      await markAllNotificationsRead(workspaceId);
      setItems((current) =>
        current.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })),
      );
      // Zero, not "minus the rows on screen": the server marked every notification in this
      // workspace, including the pages this screen never loaded.
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
      }
      if (notification.taskId && !navigated) {
        toast.error(t('openTaskError'));
      }
    } catch {
      toast.error(t('markReadError'));
    }
  }

  const hasUnread = items.some((item) => !item.readAt);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-small max-md:min-h-11">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            <span>{t('unreadOnly')}</span>
          </label>
          <label className="flex flex-col gap-1 text-small">
            <span className="text-muted-foreground">{t('typeFilter')}</span>
            <Select
              className="min-w-[10rem]"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              aria-label={t('typeFilter')}
            >
              <option value="">{t('typeAll')}</option>
              <option value={NotificationType.Assignment}>{t('typeAssignment')}</option>
              <option value={NotificationType.Mention}>{t('typeMention')}</option>
              <option value={NotificationType.DueSoon}>{t('typeDueSoon')}</option>
            </Select>
          </label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasUnread}
          onClick={() => void markAllRead()}
        >
          {t('markAllRead')}
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : error ? (
        // Same rule the bell's dropdown follows: a failed load clears the rows, so the empty
        // branch below would answer "You're caught up" for a list nobody managed to read.
        // Reported in place rather than as a toast, and with the retry the dropdown has no
        // room for — this screen is where the user came to read them, so a message that
        // vanishes on its own leaves the wrong answer as the last thing on the page.
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-body text-destructive">{error}</p>
          <Button type="button" variant="outline" onClick={reload}>
            {tErrors('retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-[color,background-color,border-color] hover:bg-accent',
                  !item.readAt && 'bg-signature-subtle',
                )}
                onClick={() => void openNotification(item)}
              >
                <span className="text-body text-foreground">{notificationTitle(item, t)}</span>
                <time
                  className="text-micro text-muted-foreground"
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toISOString()}
                >
                  {formatRelativeTime(item.createdAt, locale)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
