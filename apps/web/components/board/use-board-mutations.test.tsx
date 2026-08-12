import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ApiError } from '@/lib/api';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import type { SetStateAction } from 'react';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { useBoardMutations } from './use-board-mutations';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { post: vi.fn(), patch: vi.fn() } };
});

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const apiPost = vi.mocked(api.post);
const apiPatch = vi.mocked(api.patch);

function renderMutations() {
  const columnsRef = { current: [] as ColumnDto[] };
  const tasksRef = { current: [] as TaskDto[] };
  const setColumns = vi.fn();
  const setTasks = vi.fn((update: SetStateAction<TaskDto[]>) => {
    tasksRef.current = typeof update === 'function' ? update(tasksRef.current) : update;
  });
  const reload = vi.fn().mockResolvedValue(undefined);

  const view = renderHook(
    () =>
      useBoardMutations({
        boardId: BOARD_ID,
        columnsRef,
        tasksRef,
        setColumns,
        setTasks,
        reload,
      }),
    {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );

  return { ...view, setColumns, setTasks, tasksRef, reload };
}

/** What the bulk endpoint answers with: the whole seeded set, already ordered. */
const SEEDED_COLUMNS = [
  { id: 'c1', boardId: BOARD_ID, name: 'To Do', position: 1000, category: 'UNSTARTED' },
  { id: 'c2', boardId: BOARD_ID, name: 'In Progress', position: 2000, category: 'STARTED' },
  { id: 'c3', boardId: BOARD_ID, name: 'Done', position: 3000, category: 'COMPLETED' },
];

function apiError(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Error', message: 'failed' });
}

beforeEach(() => {
  apiPost.mockReset();
  apiPatch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBoardMutations seedDefaults', () => {
  it('seeds the whole set in one request to the defaults endpoint', async () => {
    apiPost.mockResolvedValue(SEEDED_COLUMNS as never);
    const { result, setColumns } = renderMutations();

    await result.current.seedDefaults();

    // One call, not one per column: the serial loop this replaces could fail halfway and
    // leave a board holding two of the three stages.
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]?.[0]).toBe(
      `/workspaces/${WORKSPACE_ID}/boards/${BOARD_ID}/columns/defaults`,
    );
    expect(setColumns).toHaveBeenCalledWith(SEEDED_COLUMNS);
  });

  it('sends no body, because the server owns the names and the order', async () => {
    apiPost.mockResolvedValue(SEEDED_COLUMNS as never);
    const { result } = renderMutations();

    await result.current.seedDefaults();

    // The names are written in the creator's language (ADR 0018) and the positions come from
    // the server's own catalog, so a client-supplied list would only be able to disagree.
    expect(apiPost.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('reloads instead of retrying when the board was seeded meanwhile', async () => {
    apiPost.mockRejectedValue(apiError(409));
    const { result, reload } = renderMutations();

    await result.current.seedDefaults();

    // 409 means this empty-state view is stale, not that anything failed — retrying would
    // just conflict again.
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('reports a forbidden seed without offering a retry', async () => {
    apiPost.mockRejectedValue(apiError(403));
    const { result, setColumns, reload } = renderMutations();

    await result.current.seedDefaults();

    expect(setColumns).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the board untouched when the request fails outright', async () => {
    apiPost.mockRejectedValue(new Error('network'));
    const { result, setColumns } = renderMutations();

    await result.current.seedDefaults();

    // Nothing partial can land now, so there is no half-seeded state to write into the view.
    expect(setColumns).not.toHaveBeenCalled();
  });

  it('clears the pending flag whether the seed succeeds or fails', async () => {
    apiPost.mockRejectedValue(new Error('network'));
    const { result } = renderMutations();

    await result.current.seedDefaults();

    await waitFor(() => expect(result.current.defaultsPending).toBe(false));
  });
});

describe('useBoardMutations commitTaskMove', () => {
  const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
  const TASK_A = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d11';
  const TASK_B = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d12';

  function task(id: string, position: number): TaskDto {
    return {
      id,
      boardId: BOARD_ID,
      columnId: COLUMN_ID,
      title: id,
      description: null,
      priority: 'MEDIUM',
      position,
      dueDate: null,
      estimatedMinutes: null,
      assignees: [],
      labels: [],
      createdById: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  it('does not roll back a newer optimistic order when an older move fails', async () => {
    let resolveFirst!: (value: TaskDto) => void;
    let rejectFirst!: (reason?: unknown) => void;
    const firstPatch = new Promise<TaskDto>((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    apiPatch
      .mockReturnValueOnce(firstPatch as never)
      .mockResolvedValueOnce(task(TASK_B, 500) as never);

    const { result, tasksRef, reload } = renderMutations();
    const initial = [task(TASK_A, 1000), task(TASK_B, 2000)];
    tasksRef.current = initial;

    const afterA = [task(TASK_A, 500), task(TASK_B, 2000)];
    const afterB = [task(TASK_B, 500), task(TASK_A, 1000)];

    const moveA = result.current.commitTaskMove({
      taskId: TASK_A,
      columnId: COLUMN_ID,
      beforeTaskId: null,
      afterTaskId: TASK_B,
      previousTasks: initial,
      nextTasks: afterA,
    });
    const moveB = result.current.commitTaskMove({
      taskId: TASK_B,
      columnId: COLUMN_ID,
      beforeTaskId: null,
      afterTaskId: TASK_A,
      previousTasks: afterA,
      nextTasks: afterB,
    });

    await moveB;
    expect(tasksRef.current.map((item) => item.id)).toEqual([TASK_B, TASK_A]);

    rejectFirst(new Error('network'));
    await moveA;

    // A late failure must not restore A's pre-move snapshot over B's accepted order.
    expect(tasksRef.current.map((item) => item.id)).toEqual([TASK_B, TASK_A]);
    expect(reload).toHaveBeenCalled();
    void resolveFirst;
  });
});
