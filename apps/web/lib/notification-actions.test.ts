import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType, type NotificationDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import {
  markAllNotificationsRead,
  markNotificationRead,
  openNotificationTarget,
} from './notification-actions';

// `notification-nav` is deliberately *not* mocked: the board lookup is half of what opening a
// notification does, and stubbing it would leave the "task is gone" branch untested here.
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const NOTIFICATION_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20';
const READ_AT = '2026-01-02T00:00:00.000Z';

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: NOTIFICATION_ID,
    workspaceId: WORKSPACE_ID,
    userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02',
    type: NotificationType.Mention,
    taskId: TASK_ID,
    activityId: null,
    payload: { boardId: BOARD_ID },
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function router() {
  return { push: vi.fn() };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPost.mockResolvedValue(notification({ readAt: READ_AT }) as never);
});

describe('markAllNotificationsRead', () => {
  it('clears the whole workspace in one request', async () => {
    await markAllNotificationsRead(WORKSPACE_ID);

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/notifications/read-all`);
  });
});

describe('markNotificationRead', () => {
  it('returns the row as the server left it, not the one it was handed', async () => {
    apiPost.mockResolvedValue(notification({ readAt: READ_AT }) as never);

    const updated = await markNotificationRead(WORKSPACE_ID, NOTIFICATION_ID);

    expect(apiPost).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/notifications/${NOTIFICATION_ID}/read`,
    );
    expect(updated.readAt).toBe(READ_AT);
  });
});

describe('openNotificationTarget', () => {
  it('marks an unread notification read and lands on its task', async () => {
    const nav = router();

    const result = await openNotificationTarget(WORKSPACE_ID, notification(), nav);

    expect(apiPost).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/notifications/${NOTIFICATION_ID}/read`,
    );
    expect(nav.push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`);
    expect(result).toEqual({
      navigated: true,
      updated: expect.objectContaining({ readAt: READ_AT }),
    });
  });

  /** Re-reading a row that is already read is a write nobody asked for. */
  it('does not re-mark a notification that is already read, but still opens it', async () => {
    const nav = router();

    const result = await openNotificationTarget(
      WORKSPACE_ID,
      notification({ readAt: READ_AT }),
      nav,
    );

    expect(apiPost).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`);
    expect(result.navigated).toBe(true);
    expect(result.updated).toBeNull();
  });

  /**
   * Not every notification is about a task — the type list is open, and a row with nothing to
   * open must still be markable read by clicking it.
   */
  it('marks a notification with no task read and goes nowhere', async () => {
    const nav = router();

    const result = await openNotificationTarget(WORKSPACE_ID, notification({ taskId: null }), nav);

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    expect(result.navigated).toBe(false);
  });

  /**
   * The case QA-04 named: the notification outlives its task. It is still read — the user saw
   * it — but `navigated: false` is what tells the caller to say so instead of leaving the user
   * on a screen that silently did nothing.
   */
  it('reports that it did not navigate when the task is gone', async () => {
    apiGet.mockRejectedValue(new Error('404'));
    const nav = router();

    const result = await openNotificationTarget(WORKSPACE_ID, notification({ payload: {} }), nav);

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    expect(result.navigated).toBe(false);
    expect(result.updated?.readAt).toBe(READ_AT);
  });

  it('looks the board up when the notification does not carry one', async () => {
    apiGet.mockResolvedValue({ boardId: BOARD_ID } as never);
    const nav = router();

    await openNotificationTarget(WORKSPACE_ID, notification({ payload: {} }), nav);

    expect(apiGet).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}`);
    expect(nav.push).toHaveBeenCalledWith(`/board/${BOARD_ID}/task/${TASK_ID}`);
  });
});
