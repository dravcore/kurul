import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type ChecklistDto, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { useTaskChecklists } from './use-task-checklists';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

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

    const { result, onUpdated } = renderChecklists(
      task({ checklists: null, checklistSummary: { total: 2, done: 1 } }),
    );

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(detail));
    expect(apiGet).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}`,
      expect.anything(),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
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
