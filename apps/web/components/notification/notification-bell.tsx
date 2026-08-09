'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { notificationTitle } from '@/lib/notification-copy';
import { resolveBoardIdForNotification } from '@/lib/notification-nav';
import { formatRelativeTime } from '@/lib/relative-time';
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
import { toast } from 'sonner';

const POLL_MS = 60_000;

export function NotificationBell(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const router = useRouter();
  const { activeId: workspaceId, bootstrapped } = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loadingList, setLoadingList] = useState(false);

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

  useEffect(() => {
    if (!bootstrapped || !workspaceId) return;
    const controller = new AbortController();
    void refreshUnread(controller.signal);
    const timer = window.setInterval(() => {
      void refreshUnread();
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [bootstrapped, workspaceId, refreshUnread]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const controller = new AbortController();
    setLoadingList(true);
    void (async () => {
      try {
        const page = await api.get<CursorPage<NotificationDto>>(
          `/workspaces/${workspaceId}/notifications?limit=20`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setItems(page.items);
        }
      } catch {
        if (!controller.signal.aborted) {
          toast.error(t('loadError'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingList(false);
        }
      }
    })();
    return () => controller.abort();
  }, [open, workspaceId, t]);

  async function markAllRead(): Promise<void> {
    if (!workspaceId) return;
    try {
      await api.post(`/workspaces/${workspaceId}/notifications/read-all`);
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
      if (!notification.readAt) {
        const updated = await api.post<NotificationDto>(
          `/workspaces/${workspaceId}/notifications/${notification.id}/read`,
        );
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } catch {
      toast.error(t('markReadError'));
    }

    if (!notification.taskId) {
      setOpen(false);
      return;
    }

    const boardId = await resolveBoardIdForNotification(
      workspaceId,
      notification.taskId,
      notification.payload,
    );
    setOpen(false);
    if (!boardId) {
      toast.error(t('openTaskError'));
      return;
    }
    router.push(`/board/${boardId}/task/${notification.taskId}`);
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
                  {formatRelativeTime(item.createdAt)}
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
