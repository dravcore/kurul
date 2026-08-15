import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { resolveBoardIdForNotification } from './notification-nav';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

const apiGet = vi.mocked(api.get);

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20';
const OTHER_BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d21';

beforeEach(() => {
  apiGet.mockReset();
});

describe('resolveBoardIdForNotification', () => {
  it('uses the board the notification was written with, without asking the server', async () => {
    const boardId = await resolveBoardIdForNotification(WORKSPACE_ID, TASK_ID, {
      boardId: BOARD_ID,
    });

    expect(boardId).toBe(BOARD_ID);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('asks the task which board it is on when the notification does not say', async () => {
    apiGet.mockResolvedValue({ boardId: BOARD_ID } as never);

    const boardId = await resolveBoardIdForNotification(WORKSPACE_ID, TASK_ID, {});

    expect(boardId).toBe(BOARD_ID);
    expect(apiGet).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}`);
  });

  /**
   * `payload` is `Record<string, unknown>` — whatever the API wrote when the notification was
   * created, which is not the same set of fields for every notification type. A value that is
   * not a usable id has to fall through to the task rather than become one path segment of a
   * URL that then 404s.
   */
  it.each([
    ['an empty string', { boardId: '' }],
    ['a number', { boardId: 42 }],
    ['null', { boardId: null }],
  ])('falls back to the task when the payload board id is %s', async (_label, payload) => {
    apiGet.mockResolvedValue({ boardId: OTHER_BOARD_ID } as never);

    const boardId = await resolveBoardIdForNotification(WORKSPACE_ID, TASK_ID, payload);

    expect(boardId).toBe(OTHER_BOARD_ID);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  /**
   * The case the click-through has to survive: a notification outlives the task it points at,
   * so the lookup 404s. Answering `null` is what lets the caller say "could not open this
   * task" instead of pushing `/board/undefined/task/…`.
   */
  it('answers with no board when the task the notification points at is gone', async () => {
    apiGet.mockRejectedValue(new Error('404'));

    const boardId = await resolveBoardIdForNotification(WORKSPACE_ID, TASK_ID, {});

    expect(boardId).toBeNull();
  });
});
