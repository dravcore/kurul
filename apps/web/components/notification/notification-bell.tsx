'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { NotificationMenuContent } from './notification-menu-content';
import { useNotificationMenu } from './use-notification-menu';
import { useNotificationSocket } from './use-notification-socket';
import { useNotificationUnread } from './use-notification-unread';

/**
 * The bell in the app shell.
 *
 * Composition only: the badge's count lives in `useNotificationUnread`, the dropdown's rows
 * and actions in `useNotificationMenu`, the markup in `NotificationMenuContent`. What is left
 * here is the one thing none of them can own — the single socket subscription, which both the
 * badge and the rows react to and which must not be opened twice for the same room.
 */
export function NotificationBell(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const { activeId: workspaceId, bootstrapped } = useWorkspaceContext();
  const [open, setOpen] = useState(false);

  /**
   * One signal, two readers. The badge acts on every bump; the rows only re-read while the
   * dropdown is on screen. A key rather than two callbacks because the unread hook needs
   * `connected` from the socket that would have to be handed those callbacks — passing the
   * signal down instead of the reloader up is what breaks that cycle.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshOpenViews = useCallback((): void => {
    setRefreshKey((key) => key + 1);
  }, []);

  const { connected } = useNotificationSocket(workspaceId, bootstrapped, {
    onUnreadChanged: refreshOpenViews,
    // A (re)join replays nothing, so the first thing after it is a full refresh — that is what
    // closes the gap a disconnection opened.
    onResync: refreshOpenViews,
  });

  const unread = useNotificationUnread({
    workspaceId,
    enabled: bootstrapped,
    connected,
    refreshKey,
  });
  const close = useCallback(() => setOpen(false), []);
  const menu = useNotificationMenu({
    workspaceId,
    open,
    refreshKey,
    setUnreadCount: unread.setCount,
    onClose: close,
  });

  const badgeLabel =
    unread.count > 99 ? t('badgeOverflow') : unread.count > 0 ? String(unread.count) : null;

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
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-sm)] bg-signature px-0.5 text-[10px] font-medium text-white">
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <NotificationMenuContent
        items={menu.items}
        loading={menu.loading}
        error={menu.error}
        unreadCount={unread.count}
        onMarkAllRead={() => void menu.markAllRead()}
        onOpenNotification={(notification) => void menu.openNotification(notification)}
        onClose={close}
      />
    </DropdownMenu>
  );
}
