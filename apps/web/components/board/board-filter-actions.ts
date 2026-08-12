import type { Priority } from '@kurultay/shared-types';
import type { BoardTaskFilters } from '@/lib/task-query';

/**
 * Pure transitions on the board filter state. The UI never mutates `BoardTaskFilters` in
 * place: every control hands the next value to `onChange`, which is what keeps the URL the
 * single source of truth (see `BoardView.applyFilters`).
 */

/** An empty list is dropped rather than kept, so `?priority=` never reaches the URL. */
function toggleList<T extends string>(
  current: readonly T[] | undefined,
  value: T,
): T[] | undefined {
  const next = new Set<T>(current ?? []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size > 0 ? [...next] : undefined;
}

export function togglePriorityFilter(
  filters: BoardTaskFilters,
  priority: Priority,
): BoardTaskFilters {
  return { ...filters, priority: toggleList(filters.priority, priority) };
}

/** `userId` is a member id, or the literal `'null'` for the unassigned bucket. */
export function toggleAssigneeFilter(filters: BoardTaskFilters, userId: string): BoardTaskFilters {
  return { ...filters, assigneeId: toggleList(filters.assigneeId, userId) };
}

export function toggleLabelFilter(filters: BoardTaskFilters, labelId: string): BoardTaskFilters {
  return { ...filters, labelId: toggleList(filters.labelId, labelId) };
}

/** The presets the due-date menu offers; `range` is only ever arrived at from the URL. */
export type DueFilterPreset = 'none' | 'overdue' | 'range';

/** Which preset the current due-date fields read as, or `null` when none is set. */
export function resolveDuePreset(filters: BoardTaskFilters): DueFilterPreset | null {
  if (filters.dueDateNull) return 'none';
  if (filters.dueDateLte && !filters.dueDateGte) return 'overdue';
  if (filters.dueDateGte || filters.dueDateLte) return 'range';
  return null;
}

/**
 * The three due-date fields move together — a preset always replaces the whole trio, so a
 * leftover `dueDate[gte]` from a previous selection can never survive into the next one.
 */
export function setDueFilter(
  filters: BoardTaskFilters,
  preset: 'none' | 'overdue' | 'clear',
): BoardTaskFilters {
  const cleared: BoardTaskFilters = {
    ...filters,
    dueDateNull: undefined,
    dueDateGte: undefined,
    dueDateLte: undefined,
  };
  if (preset === 'clear') return cleared;
  if (preset === 'none') return { ...cleared, dueDateNull: true };
  return { ...cleared, dueDateLte: new Date().toISOString() };
}
