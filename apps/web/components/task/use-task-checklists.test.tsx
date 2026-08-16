import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type ChecklistDto, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { useTaskChecklists } from './use-task-checklists';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const OTHER_TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiPatch = vi.mocked(api.patch);
const apiDelete = vi.mocked(api.delete);

const CHECKLISTS: ChecklistDto[] = [
  {
    id: 'c1',
    title: 'Preparation',
    position: 1000,
    items: [
      { id: 'i1', content: 'Design', isDone: true, position: 1000 },
      { id: 'i2', content: 'API', isDone: false, position: 2000 },
    ],
  },
];

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: TASK_ID,
    boardId: 'board-1',
    columnId: 'column-1',
    title: 'Task',
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 2, done: 1 },
    checklists: CHECKLISTS,
    attachmentCount: 0,
    ...overrides,
  };
}

function renderChecklists(initial: TaskDto | null, canMutate = true) {
  const onUpdated = vi.fn();
  const view = renderHook(
    ({ current }: { current: TaskDto | null }) =>
      useTaskChecklists({
        workspaceId: WORKSPACE_ID,
        task: current,
        canMutate,
        onUpdated,
      }),
    {
      initialProps: { current: initial },
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );
  return { ...view, onUpdated };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTaskChecklists loading', () => {
  it('fetches the task detail when the board row carries only the summary', async () => {
    const detail = task();
    apiGet.mockResolvedValue(detail);

    const { result, rerender, onUpdated } = renderChecklists(
      task({ checklists: null, checklistSummary: { total: 2, done: 1 } }),
    );

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(detail));
    expect(apiGet).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}`,
      expect.anything(),
    );
    // Still loading until the merged row comes back down — `loading` is derived from the task
    // the panel is holding, not from a flag the hook lowers on its own. The board's merge is
    // what ends it, which is the same thing the reader sees.
    expect(result.current.loading).toBe(true);

    rerender({ current: detail });

    expect(result.current.loading).toBe(false);
    expect(result.current.checklists).toEqual(CHECKLISTS);
  });

  it('does not re-read a task whose checklists are already in hand', async () => {
    renderChecklists(task());

    await waitFor(() => expect(apiGet).not.toHaveBeenCalled());
  });

  it('reports a failed read instead of letting the panel claim the task has no checklist', async () => {
    apiGet.mockRejectedValue(new Error('offline'));

    const { result } = renderChecklists(task({ checklists: null }));

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it('reads again when a board refetch puts the summary-only row back', async () => {
    // A filter change re-runs the board's list query, and its rows carry `checklists: null`.
    // A once-per-task guard would leave the open panel rendering the empty state for a task
    // whose checklists it had already read — the "not loaded means none" mistake, arrived at
    // from the other direction.
    apiGet.mockResolvedValue(task());
    const { rerender } = renderChecklists(task({ checklists: null }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    rerender({ current: task() });
    rerender({ current: task({ checklists: null }) });

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('does not turn a failed read into a request per render', async () => {
    apiGet.mockRejectedValue(new Error('offline'));

    const { result, rerender } = renderChecklists(task({ checklists: null }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // A failure leaves `checklists` null, so every render still "needs" the detail. What stops
    // the loop is that nothing the read depends on changed — not a remembered failure.
    rerender({ current: task({ checklists: null, title: 'renamed' }) });
    rerender({ current: task({ checklists: null, title: 'renamed twice' }) });

    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("does not tell the next task about the previous one's failure", async () => {
    apiGet
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => new Promise(() => {}));

    const { result, rerender } = renderChecklists(task({ checklists: null }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // The reader moves to another card. Its read is still in flight, so the section owes them
    // "loading" — a failure carried across would say "the checklists couldn't load" about a
    // task nothing has been asked about yet.
    rerender({ current: task({ id: OTHER_TASK_ID, checklists: null }) });

    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loading).toBe(true);
  });

  it('tries again for a task the reader comes back to', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(task());

    const { result, rerender } = renderChecklists(task({ checklists: null }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // Away to another task and back. A remembered failure would make one bad moment of network
    // stick to this task for the rest of the session.
    rerender({ current: null });
    rerender({ current: task({ checklists: null }) });

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loadFailed).toBe(false));
  });
});

describe('useTaskChecklists writes', () => {
  it('ticks the box before the server answers and keeps the badge in step', async () => {
    apiPatch.mockImplementation(() => new Promise(() => {}));

    const { result, onUpdated } = renderChecklists(task());

    act(() => {
      void result.current.toggleItem('i2', true);
    });

    // The optimistic patch carries the recounted summary, not just the item: the board card's
    // badge reads `checklistSummary`, so leaving it stale would show 1/2 next to two ticks.
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID, checklistSummary: { total: 2, done: 2 } }),
    );
    const patched = onUpdated.mock.calls[0]![0] as TaskDto;
    expect(patched.checklists![0]!.items[1]!.isDone).toBe(true);
    expect(apiPatch).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/checklist-items/i2`,
      { isDone: true },
    );
  });

  it('puts the tick back when the server refuses it', async () => {
    apiPatch.mockRejectedValue(new Error('nope'));

    const { result, onUpdated } = renderChecklists(task());

    await act(async () => {
      await result.current.toggleItem('i2', true);
    });

    const restored = onUpdated.mock.calls.at(-1)![0] as TaskDto;
    expect(restored.checklists).toEqual(CHECKLISTS);
    expect(restored.checklistSummary).toEqual({ total: 2, done: 1 });
  });

  it('adds a checklist and adopts the task the server answers with', async () => {
    const answer = task({ checklists: [...CHECKLISTS] });
    apiPost.mockResolvedValue(answer);

    const { result, onUpdated } = renderChecklists(task());

    await act(async () => {
      await expect(result.current.addChecklist('Release')).resolves.toBe(true);
    });

    expect(apiPost).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/checklists`,
      {
        title: 'Release',
      },
    );
    expect(onUpdated).toHaveBeenCalledWith(answer);
  });

  it('adds an item under the checklist it was given', async () => {
    apiPost.mockResolvedValue(task());

    const { result } = renderChecklists(task());

    await act(async () => {
      await result.current.addItem('c1', 'Tag the release');
    });

    expect(apiPost).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/checklists/c1/items`,
      { content: 'Tag the release' },
    );
  });

  it('deletes a checklist through the task it hangs off', async () => {
    apiDelete.mockResolvedValue(task());

    const { result } = renderChecklists(task());

    await act(async () => {
      await result.current.removeChecklist('c1');
    });

    expect(apiDelete).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/checklists/c1`,
    );
  });

  it('deletes an item by its own id, the shallow address the API exposes', async () => {
    apiDelete.mockResolvedValue(task());

    const { result } = renderChecklists(task());

    await act(async () => {
      await result.current.removeItem('i2');
    });

    expect(apiDelete).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/checklist-items/i2`,
    );
  });

  it('sends nothing at all for a reader who cannot mutate the task', async () => {
    const { result } = renderChecklists(task(), false);

    await act(async () => {
      await result.current.addChecklist('Release');
      await result.current.toggleItem('i2', true);
      await result.current.removeItem('i2');
    });

    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiDelete).not.toHaveBeenCalled();
  });
});
