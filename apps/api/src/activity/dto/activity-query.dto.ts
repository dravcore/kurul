import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(Math.trunc(n), 100);
}

/** Cursor page query for activity feeds (newest-first via id desc). */
export class ActivityQueryDto {
  @IsOptional()
  @Transform(({ value }) => clampLimit(value ?? 50))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}
