'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { NotificationDto } from '@kurul/shared-types';
import { notificationTitle } from '@/lib/notification-copy';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface NotificationMenuContentProps {
  items: NotificationDto[];
  loading: boolean;
  error: string | null;
  /** Disables "mark all read" — there is nothing to mark. */
  unreadCount: number;
  onMarkAllRead: () => void;
  onOpenNotification: (notification: NotificationDto) => void;
  onClose: () => void;
}

/** The bell's dropdown: a header with the bulk action, the rows, and the link to the page. */
export function NotificationMenuContent({
  items,
  loading,
  error,
  unreadCount,
  onMarkAllRead,
  onOpenNotification,
  onClose,
}: NotificationMenuContentProps): React.ReactElement {
  const t = useTranslations('app.notifications');
  const locale = useLocale();
  const router = useRouter();

  return (
    <DropdownMenuContent align="end" className="w-80 p-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <DropdownMenuLabel className="p-0">{t('title')}</DropdownMenuLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={unreadCount === 0}
          onClick={onMarkAllRead}
        >
          {t('markAllRead')}
        </Button>
      </div>
      <DropdownMenuSeparator className="m-0" />
      <div className="max-h-80 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-4 text-small text-muted-foreground">{t('loading')}</p>
        ) : error ? (
          // Reported here rather than as a toast: the load clears the rows, and an empty
          // "You're caught up" is the one thing this must not say after a failure.
          <p className="px-3 py-4 text-small text-destructive">{error}</p>
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
                // The row navigates and marks read on its own; letting the menu close first
                // would unmount the handler mid-request.
                event.preventDefault();
                onOpenNotification(item);
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
            onClose();
            router.push('/notifications');
          }}
        >
          {t('viewAll')}
        </Button>
      </div>
    </DropdownMenuContent>
  );
}
