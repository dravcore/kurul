import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ApiError } from '@/lib/api';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
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

function renderMutations() {
  const columnsRef = { current: [] as ColumnDto[] };
  const tasksRef = { current: [] as TaskDto[] };
  const setColumns = vi.fn();
  const reload = vi.fn().mockResolvedValue(undefined);

  const view = renderHook(
    () =>
      useBoardMutations({
        boardId: BOARD_ID,
        columnsRef,
        tasksRef,
        setColumns,
        setTasks: vi.fn(),
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

  return { ...view, setColumns, reload };
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
