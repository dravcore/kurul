'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { NotificationMenuContent } from './notification-menu-content';
import { useNotificationUnreadContext } from './notification-unread-provider';
import { useNotificationMenu } from './use-notification-menu';

/**
 * The bell in the app shell.
 *
 * Composition only: the badge's count and the socket behind it live in
 * `NotificationUnreadProvider`, the dropdown's rows and actions in `useNotificationMenu`, the
 * markup in `NotificationMenuContent`. The count is read from the shell rather than owned here
 * because the notifications page moves the same number and is not in this subtree.
 */
export function NotificationBell(): React.ReactElement {
  const t = useTranslations('app.notifications');
  const { activeId: workspaceId } = useWorkspaceContext();
  const [open, setOpen] = useState(false);

  // `setCount` is the badge's own setter: a row read in the dropdown moves the shared count
  // without asking the server for a number it already knows.
  const { count, setCount, refreshKey } = useNotificationUnreadContext();

  const close = useCallback(() => setOpen(false), []);
  const menu = useNotificationMenu({
    workspaceId,
    open,
    refreshKey,
    setUnreadCount: setCount,
    onClose: close,
  });

  const badgeLabel = count > 99 ? t('badgeOverflow') : count > 0 ? String(count) : null;

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
          {/* `text-primary-foreground`, not `text-white`: copper is the light theme's ink and the
              dark theme's paint, so the one colour that stays readable on it is the token that
              flips with it. White holds 5.05:1 on the light copper and 2.73:1 on the dark one,
              which is this count unreadable in half the app. */}
          {badgeLabel ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-sm)] bg-signature px-0.5 text-[10px] font-medium text-primary-foreground">
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <NotificationMenuContent
        items={menu.items}
        loading={menu.loading}
        error={menu.error}
        unreadCount={count}
        onMarkAllRead={() => void menu.markAllRead()}
        onOpenNotification={(notification) => void menu.openNotification(notification)}
        onClose={close}
      />
    </DropdownMenu>
  );
}
