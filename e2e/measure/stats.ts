import { cpus, totalmem } from 'node:os';

/**
 * The little that both measurement files need: order statistics, and a machine description.
 *
 * Order statistics rather than a mean, everywhere. A mean over ten uploads is one long GC
 * pause away from describing a run that never happened, and the phase plan asks specifically
 * for a median *and* a p95 — the median for the typical case, the p95 for the case a user
 * notices and reports.
 */

/** Sorted ascending; the caller's array is left alone. */
export function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function median(values: number[]): number {
  const list = sorted(values);
  const middle = Math.floor(list.length / 2);
  if (list.length === 0) return Number.NaN;
  return list.length % 2 === 0
    ? ((list[middle - 1] ?? 0) + (list[middle] ?? 0)) / 2
    : (list[middle] ?? 0);
}

/**
 * The nearest-rank p95: the smallest sample at or above 95% of the ordered set.
 *
 * Nearest-rank rather than an interpolating definition because these sample counts are small.
 * With ten runs *every* p95 estimator is really "the worst run" wearing different arithmetic,
 * and saying so with a definition that returns an observed value is more honest than
 * interpolating between two of them and printing a number nothing measured.
 */
export function p95(values: number[]): number {
  const list = sorted(values);
  if (list.length === 0) return Number.NaN;
  const rank = Math.ceil(0.95 * list.length);
  return list[Math.min(rank, list.length) - 1] ?? Number.NaN;
}

export function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}

/**
 * Who took the measurement.
 *
 * Printed with every report because a duration without a machine is not a result — the phase
 * plan's §4.1b requirement is exactly this, and it is the line that keeps a number measured on
 * an M3 laptop from being quoted as though a 2-vCPU VPS would see it.
 */
export function machine(): string {
  const model = cpus()[0]?.model ?? 'unknown CPU';
  const gb = Math.round(totalmem() / 1024 ** 3);
  return `${model} · ${cpus().length} cores · ${gb} GB · ${process.platform} ${process.arch} · Node ${process.versions.node}`;
}

/** One block of output per measurement, so a report can be pasted whole. */
export function report(title: string, lines: string[]): void {
  const body = ['', `── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`, ...lines, ''];
  process.stdout.write(`${body.join('\n')}\n`);
}
