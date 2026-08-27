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
          {/* `bg-foreground text-background`, not the signature: docs/design.md §2 puts badges
              in the column copper must not touch, and an unread count is not an error either, so
              `--destructive` is not the answer (that family stays reserved for status and
              priority, docs/design.md §3). The ink/canvas pair already flips with the theme and
              holds 14.57:1 light, 15.17:1 dark, against the signature fill's 2.73:1 dark AA
              fail. */}
          {badgeLabel ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-foreground px-0.5 text-micro font-strong text-background">
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
