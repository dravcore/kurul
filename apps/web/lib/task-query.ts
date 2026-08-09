import type { CursorPage, Priority, TaskDto } from '@kurultay/shared-types';
import { Priority as PriorityEnum } from '@kurultay/shared-types';
import { api } from '@/lib/api';

const PRIORITY_VALUES = new Set<string>(Object.values(PriorityEnum));

export interface BoardTaskFilters {
  q?: string;
  priority?: Priority[];
  /** User ids, or the literal `null` for unassigned. */
  assigneeId?: string[];
  labelId?: string[];
  /** When true, maps to `dueDate=null`. */
  dueDateNull?: boolean;
  dueDateGte?: string;
  dueDateLte?: string;
}

const FILTER_KEYS = new Set([
  'q',
  'priority',
  'assigneeId',
  'labelId',
  'dueDate',
  'dueDate[gte]',
  'dueDate[lte]',
]);

function collectList(params: URLSearchParams, key: string): string[] {
  const fromAll = params.getAll(key);
  const values: string[] = [];
  for (const entry of fromAll) {
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim();
      if (trimmed) values.push(trimmed);
    }
  }
  return values;
}

/** Parse board filter state from the page URL (api-conventions keys). */
export function parseFiltersFromSearchParams(params: URLSearchParams): BoardTaskFilters {
  const filters: BoardTaskFilters = {};

  const q = params.get('q')?.trim();
  if (q) filters.q = q;

  const priorities = collectList(params, 'priority').filter((value): value is Priority =>
    PRIORITY_VALUES.has(value),
  );
  if (priorities.length > 0) filters.priority = priorities;

  const assignees = collectList(params, 'assigneeId');
  if (assignees.length > 0) filters.assigneeId = assignees;

  const labels = collectList(params, 'labelId');
  if (labels.length > 0) filters.labelId = labels;

  if (params.get('dueDate') === 'null') {
    filters.dueDateNull = true;
  }

  const gte = params.get('dueDate[gte]');
  if (gte) filters.dueDateGte = gte;

  const lte = params.get('dueDate[lte]');
  if (lte) filters.dueDateLte = lte;

  return filters;
}

/** Serialize filters into URL/API search params (only filter keys). */
export function serializeFiltersToSearchParams(filters: BoardTaskFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.q?.trim()) params.set('q', filters.q.trim());

  if (filters.priority && filters.priority.length > 0) {
    params.set('priority', filters.priority.join(','));
  }

  if (filters.assigneeId && filters.assigneeId.length > 0) {
    params.set('assigneeId', filters.assigneeId.join(','));
  }

  if (filters.labelId && filters.labelId.length > 0) {
    params.set('labelId', filters.labelId.join(','));
  }

  if (filters.dueDateNull) {
    params.set('dueDate', 'null');
  }

  if (filters.dueDateGte) params.set('dueDate[gte]', filters.dueDateGte);
  if (filters.dueDateLte) params.set('dueDate[lte]', filters.dueDateLte);

  return params;
}

export function hasActiveFilters(filters: BoardTaskFilters): boolean {
  return (
    Boolean(filters.q?.trim()) ||
    (filters.priority?.length ?? 0) > 0 ||
    (filters.assigneeId?.length ?? 0) > 0 ||
    (filters.labelId?.length ?? 0) > 0 ||
    Boolean(filters.dueDateNull) ||
    Boolean(filters.dueDateGte) ||
    Boolean(filters.dueDateLte)
  );
}

export function countActiveFilters(filters: BoardTaskFilters): number {
  let count = 0;
  if (filters.q?.trim()) count += 1;
  count += filters.priority?.length ?? 0;
  count += filters.assigneeId?.length ?? 0;
  count += filters.labelId?.length ?? 0;
  if (filters.dueDateNull) count += 1;
  if (filters.dueDateGte || filters.dueDateLte) count += 1;
  return count;
}

/** Replace filter keys on an existing URLSearchParams, keep unrelated keys. */
export function mergeFiltersIntoSearchParams(
  current: URLSearchParams,
  filters: BoardTaskFilters,
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  for (const key of [...next.keys()]) {
    if (FILTER_KEYS.has(key)) next.delete(key);
  }
  const encoded = serializeFiltersToSearchParams(filters);
  for (const [key, value] of encoded.entries()) {
    next.append(key, value);
  }
  return next;
}

/**
 * Drain cursor pages until exhausted. Display order is caller's job (`position, id`).
 */
export async function fetchAllBoardTasks(
  workspaceId: string,
  boardId: string,
  filters: BoardTaskFilters = {},
  init?: RequestInit,
): Promise<TaskDto[]> {
  const items: TaskDto[] = [];
  let cursor: string | undefined;
  const filterParams = serializeFiltersToSearchParams(filters);

  for (;;) {
    const params = new URLSearchParams(filterParams.toString());
    params.set('limit', '100');
    if (cursor) params.set('cursor', cursor);

    const page = await api.get<CursorPage<TaskDto>>(
      `/workspaces/${workspaceId}/boards/${boardId}/tasks?${params.toString()}`,
      init,
    );

    items.push(...page.items);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return items;
}
