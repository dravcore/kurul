import type { DashboardThroughputDay } from '@kurultay/shared-types';

export const THROUGHPUT_DAYS = 14;

/** UTC calendar date key `YYYY-MM-DD`. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Zero-filled series for the last `THROUGHPUT_DAYS` UTC days ending today. */
export function emptyThroughputSeries(now: Date = new Date()): DashboardThroughputDay[] {
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: DashboardThroughputDay[] = [];
  for (let i = THROUGHPUT_DAYS - 1; i >= 0; i -= 1) {
    days.push({
      date: utcDateKey(new Date(endUtc - i * 86_400_000)),
      created: 0,
      completed: 0,
    });
  }
  return days;
}

export function isDoneColumnName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().toLowerCase() === 'done';
}

/** Prefer payload `toColumnName`; fall back to Done column ids for older rows. */
export function isCompletedMove(
  payload: Record<string, unknown>,
  doneColumnIds: ReadonlySet<string>,
): boolean {
  if (isDoneColumnName(payload.toColumnName)) return true;
  const toColumnId = payload.toColumnId;
  return typeof toColumnId === 'string' && doneColumnIds.has(toColumnId);
}

export function applyThroughputCounts(
  series: DashboardThroughputDay[],
  createdAts: Date[],
  completedAts: Date[],
): DashboardThroughputDay[] {
  const created = new Map<string, number>();
  for (const at of createdAts) {
    const key = utcDateKey(at);
    created.set(key, (created.get(key) ?? 0) + 1);
  }
  const completed = new Map<string, number>();
  for (const at of completedAts) {
    const key = utcDateKey(at);
    completed.set(key, (completed.get(key) ?? 0) + 1);
  }
  return applyThroughputDayCounts(series, created, completed);
}

/** Apply pre-aggregated per-day counts onto a zero-filled series. */
export function applyThroughputDayCounts(
  series: DashboardThroughputDay[],
  createdByDay: ReadonlyMap<string, number>,
  completedByDay: ReadonlyMap<string, number>,
): DashboardThroughputDay[] {
  return series.map((day) => ({
    date: day.date,
    created: createdByDay.get(day.date) ?? 0,
    completed: completedByDay.get(day.date) ?? 0,
  }));
}
