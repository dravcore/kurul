'use client';

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { CursorPage, NotificationDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { markAllNotificationsRead, openNotificationTarget } from '@/lib/notification-actions';
import { useApiResource } from '@/lib/use-api-resource';

const PAGE_LIMIT = 20;

/** Stable identity so the closed dropdown does not reset its rows on every render. */
const EMPTY_ITEMS: NotificationDto[] = [];

export interface UseNotificationMenuOptions {
  workspaceId: string | null;
  /** The dropdown is open. A closed bell needs the badge, not the rows. */
  open: boolean;
  /**
   * Bumped by the bell when the socket says something changed. The rows are re-read only
   * while the dropdown is open, so this is a signal rather than a call.
   */
  refreshKey: number;
  /** The badge's setter — a row read here moves the same count the badge shows. */
  setUnreadCount: Dispatch<SetStateAction<number>>;
  onClose: () => void;
}

export interface NotificationMenu {
  items: NotificationDto[];
  loading: boolean;
  /** The rows could not be read; shown in place, because an empty list would lie. */
  error: string | null;
  markAllRead: () => Promise<void>;
  openNotification: (notification: NotificationDto) => Promise<void>;
}

/**
 * The dropdown's rows and the two things you can do to them.
 *
 * Both actions patch the list and the badge locally rather than refetching: the server has
 * already told us what changed, and a round trip here would show the row un-reading itself
 * for a frame before settling.
 */
export function useNotificationMenu({
  workspaceId,
  open,
  refreshKey,
  setUnreadCount,
  onClose,
}: UseNotificationMenuOptions): NotificationMenu {
  const t = useTranslations('app.notifications');
  const router = useRouter();

  const fetchItems = useMemo(
    () =>
      open && workspaceId
        ? (signal: AbortSignal): Promise<NotificationDto[]> =>
            api
              .get<CursorPage<NotificationDto>>(
                `/workspaces/${workspaceId}/notifications?limit=${PAGE_LIMIT}`,
                { signal },
              )
              .then((page) => page.items)
        : null,
    // `refreshKey` is not read by the loader — it is a dependency because the resource
    // reloads when the fetcher's identity changes, which is how a bump becomes a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, workspaceId, refreshKey],
  );

  const {
    data: items,
    loading,
    error,
    setData: setItems,
  } = useApiResource<NotificationDto[]>(fetchItems, EMPTY_ITEMS, t('loadError'));

  const markAllRead = useCallback(async (): Promise<void> => {
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
  }, [workspaceId, setItems, setUnreadCount, t]);

  const openNotification = useCallback(
    async (notification: NotificationDto): Promise<void> => {
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
        onClose();
        if (notification.taskId && !navigated) {
          toast.error(t('openTaskError'));
        }
      } catch {
        toast.error(t('markReadError'));
        onClose();
      }
    },
    [workspaceId, router, setItems, setUnreadCount, onClose, t],
  );

  return { items, loading, error, markAllRead, openNotification };
}
