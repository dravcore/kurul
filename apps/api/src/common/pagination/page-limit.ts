import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Page size used when `?limit=` is absent or unusable (api-conventions). */
export const DEFAULT_PAGE_LIMIT = 50;

/** Hard ceiling on page size, whatever the client asks for. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Coerces a raw `?limit=` value into the allowed range.
 *
 * Junk (`abc`, `''`, `-3`) falls back rather than 400s — a bad page size should not fail
 * a read — while oversized requests are truncated to `max` and floats lose their tail.
 */
export function clampLimit(
  value: unknown,
  fallback: number = DEFAULT_PAGE_LIMIT,
  max: number = MAX_PAGE_LIMIT,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(Math.trunc(parsed), max);
}

/**
 * The `limit` field of a cursor page query: clamped on the way in, then re-validated so a
 * future change to `clampLimit` cannot silently widen the contract.
 */
export function PageLimit(
  fallback: number = DEFAULT_PAGE_LIMIT,
  max: number = MAX_PAGE_LIMIT,
): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) => clampLimit(value, fallback, max)),
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(max),
  );
}
