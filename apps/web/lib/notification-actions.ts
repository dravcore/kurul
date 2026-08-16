import type { NotificationDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { resolveBoardIdForNotification } from '@/lib/notification-nav';

export async function markAllNotificationsRead(workspaceId: string): Promise<void> {
  await api.post(`/workspaces/${workspaceId}/notifications/read-all`);
}

export async function markNotificationRead(
  workspaceId: string,
  notificationId: string,
): Promise<NotificationDto> {
  return api.post<NotificationDto>(
    `/workspaces/${workspaceId}/notifications/${notificationId}/read`,
  );
}

/**
 * Mark read (if needed) and navigate to the related task when possible.
 * Returns whether navigation happened.
 */
export async function openNotificationTarget(
  workspaceId: string,
  notification: NotificationDto,
  router: { push: (href: string) => void },
): Promise<{ navigated: boolean; updated: NotificationDto | null }> {
  let updated: NotificationDto | null = null;
  if (!notification.readAt) {
    updated = await markNotificationRead(workspaceId, notification.id);
  }

  if (!notification.taskId) {
    return { navigated: false, updated };
  }

  const boardId = await resolveBoardIdForNotification(
    workspaceId,
    notification.taskId,
    notification.payload,
  );
  if (!boardId) {
    return { navigated: false, updated };
  }

  router.push(`/board/${boardId}/task/${notification.taskId}`);
  return { navigated: true, updated };
}
