import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, type CursorPage, type TaskDto } from '@kurul/shared-types';
import {
  BOARD_TASK_PAGE_LIMIT,
  countActiveFilters,
  countActiveMenuFilters,
  fetchAllBoardTasks,
  hasActiveFilters,
  mergeFiltersIntoSearchParams,
  parseFiltersFromSearchParams,
  serializeFiltersToSearchParams,
  type BoardTaskFilters,
  type BoardTaskPage,
} from './task-query';
import { api } from './api';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

const apiGet = vi.mocked(api.get);

describe('task-query filters', () => {
  it('round-trips filter state through search params', () => {
    const filters: BoardTaskFilters = {
      q: 'login',
      priority: [Priority.HIGH, Priority.URGENT],
      assigneeId: ['null', '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53'],
      labelId: ['0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'],
      dueDateNull: true,
    };

    const params = serializeFiltersToSearchParams(filters);
    expect(params.get('q')).toBe('login');
    expect(params.get('priority')).toBe('HIGH,URGENT');
    expect(params.get('assigneeId')).toBe('null,0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53');
    expect(params.get('dueDate')).toBe('null');

    expect(parseFiltersFromSearchParams(params)).toEqual(filters);
  });

  it('parses due date range bracket keys', () => {
    const params = new URLSearchParams();
    params.set('dueDate[gte]', '2026-01-01T00:00:00.000Z');
    params.set('dueDate[lte]', '2026-12-31T00:00:00.000Z');

    expect(parseFiltersFromSearchParams(params)).toEqual({
      dueDateGte: '2026-01-01T00:00:00.000Z',
      dueDateLte: '2026-12-31T00:00:00.000Z',
    });
  });

  it('counts and detects active filters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(countActiveFilters({ q: 'x', priority: [Priority.LOW], dueDateNull: true })).toBe(3);
  });

  it('counts all filters including search term', () => {
    // Search term alone counts as 1 filter for the board view/empty state message
    expect(countActiveFilters({ q: 'search query' })).toBe(1);
    // Menu filters plus search term
    expect(countActiveFilters({ q: 'search query', priority: [Priority.HIGH] })).toBe(2);
    expect(
      countActiveFilters({
        q: 'search query',
        priority: [Priority.HIGH, Priority.MEDIUM],
        assigneeId: ['user-1'],
        labelId: ['label-1', 'label-2'],
        dueDateNull: true,
      }),
    ).toBe(7);
  });

  it('counts only menu filters, not the free-text search term', () => {
    // Search term alone should not count toward the Filters badge
    expect(countActiveMenuFilters({ q: 'search query' })).toBe(0);
    // Menu filters should count regardless of search term
    expect(countActiveMenuFilters({ q: 'search query', priority: [Priority.HIGH] })).toBe(1);
    expect(
      countActiveMenuFilters({
        q: 'search query',
        priority: [Priority.HIGH, Priority.MEDIUM],
        assigneeId: ['user-1'],
        labelId: ['label-1', 'label-2'],
        dueDateNull: true,
      }),
    ).toBe(6);
  });

  it('merges filters without dropping unrelated params', () => {
    const current = new URLSearchParams('tab=activity&q=old');
    const merged = mergeFiltersIntoSearchParams(current, { priority: [Priority.HIGH] });
    expect(merged.get('tab')).toBe('activity');
    expect(merged.get('q')).toBeNull();
    expect(merged.get('priority')).toBe('HIGH');
  });
});

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

function task(id: string): TaskDto {
  return {
    id,
    boardId: BOARD_ID,
    columnId: 'column-1',
    title: id,
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
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  };
}

function page(ids: string[], nextCursor: string | null): CursorPage<TaskDto> {
  return { items: ids.map(task), nextCursor, hasMore: nextCursor !== null };
}

describe('fetchAllBoardTasks', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('asks for the largest page the API will serve', async () => {
    apiGet.mockResolvedValueOnce(page(['a'], null));

    await fetchAllBoardTasks(WORKSPACE_ID, BOARD_ID);

    expect(BOARD_TASK_PAGE_LIMIT).toBe(100);
    expect(apiGet).toHaveBeenCalledTimes(1);
    const url = apiGet.mock.calls[0]?.[0] ?? '';
    expect(url).toContain(`limit=${BOARD_TASK_PAGE_LIMIT}`);
    expect(url).not.toContain('cursor=');
  });

  it('reports every page as it lands so the caller can paint the first one', async () => {
    apiGet
      .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
      .mockResolvedValueOnce(page(['c'], null));

    const seen: BoardTaskPage[] = [];
    const all = await fetchAllBoardTasks(
      WORKSPACE_ID,
      BOARD_ID,
      {},
      { onPage: (received) => seen.push(received) },
    );

    expect(all.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ index: 0, hasMore: true });
    expect(seen[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(seen[1]).toMatchObject({ index: 1, hasMore: false });
    expect(apiGet.mock.calls[1]?.[0]).toContain('cursor=cursor-1');
  });

  it('keeps the caller filters on every page request', async () => {
    apiGet.mockResolvedValueOnce(page(['a'], 'cursor-1')).mockResolvedValueOnce(page(['b'], null));

    await fetchAllBoardTasks(WORKSPACE_ID, BOARD_ID, { priority: [Priority.HIGH] });

    expect(apiGet.mock.calls).toHaveLength(2);
    for (const call of apiGet.mock.calls) {
      expect(call[0]).toContain('priority=HIGH');
    }
  });

  it('stops instead of looping when the cursor does not advance', async () => {
    apiGet.mockResolvedValue(page(['a'], 'stuck'));

    const all = await fetchAllBoardTasks(WORKSPACE_ID, BOARD_ID);

    // First page returns `stuck`, second returns `stuck` again: that is the end of it.
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(2);
  });

  it('drops a page that landed after the caller aborted', async () => {
    const controller = new AbortController();
    apiGet.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(page(['a'], 'cursor-1'));
    });
    const onPage = vi.fn();

    const all = await fetchAllBoardTasks(
      WORKSPACE_ID,
      BOARD_ID,
      {},
      { init: { signal: controller.signal }, onPage },
    );

    expect(all).toEqual([]);
    expect(onPage).not.toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
