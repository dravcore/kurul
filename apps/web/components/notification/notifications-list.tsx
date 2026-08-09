'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NotificationType, type CursorPage, type NotificationDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { notificationTitle } from '@/lib/notification-copy';
import { markAllNotificationsRead, openNotificationTarget } from '@/lib/notification-actions';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

const PAGE_LIMIT = 50;

type TypeFilter = '' | (typeof NotificationType)[keyof typeof NotificationType];

export function NotificationsList(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const router = useRouter();
  const { activeId: workspaceId } = useWorkspaceContext();

  const [items, setItems] = useState<NotificationDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const page = await api.get<CursorPage<NotificationDto>>(
          `/workspaces/${workspaceId}/notifications?${buildQuery()}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setItems(page.items);
          setNextCursor(page.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) {
          toast.error(t('loadError'));
          setItems([]);
          setNextCursor(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, buildQuery, t]);

  async function loadMore(): Promise<void> {
    if (!workspaceId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<CursorPage<NotificationDto>>(
        `/workspaces/${workspaceId}/notifications?${buildQuery(nextCursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
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
          <label className="flex items-center gap-2 text-small">
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
            <select
              className="h-9 min-w-[10rem] rounded-md border border-input bg-transparent px-3 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              aria-label={t('typeFilter')}
            >
              <option value="">{t('typeAll')}</option>
              <option value={NotificationType.Assignment}>{t('typeAssignment')}</option>
              <option value={NotificationType.Mention}>{t('typeMention')}</option>
              <option value={NotificationType.DueSoon}>{t('typeDueSoon')}</option>
            </select>
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
          <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
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
                  'flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                  !item.readAt && 'bg-signature-subtle/40',
                )}
                onClick={() => void openNotification(item)}
              >
                <span className="text-body text-foreground">{notificationTitle(item, t)}</span>
                <time
                  className="text-micro text-muted-foreground"
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toISOString()}
                >
                  {formatRelativeTime(item.createdAt)}
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
