import { NotificationType, type NotificationDto } from '@kurul/shared-types';

/** Resolve display title for a notification using next-intl keys under app.notifications. */
export function notificationTitle(
  n: NotificationDto,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const title = typeof n.payload.title === 'string' ? n.payload.title : '';
  switch (n.type) {
    case NotificationType.Assignment:
      return t('types.assignment', { title });
    case NotificationType.Mention:
      return t('types.mention', { title });
    case NotificationType.DueSoon:
      return t('types.dueSoon', { title });
    default:
      return t('types.unknown', { type: n.type });
  }
}
