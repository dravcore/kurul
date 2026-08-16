import type { DashboardThroughputDay } from '@kurul/shared-types';

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
