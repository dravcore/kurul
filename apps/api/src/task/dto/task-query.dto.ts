import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Priority } from '@kurultay/shared-types';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Split CSV or repeated query values into a flat string list. */
function toStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parts = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const part of parts) {
    for (const piece of String(part).split(',')) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out.length > 0 ? out : undefined;
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(Math.trunc(n), 100);
}

@ValidatorConstraint({ name: 'assigneeIdList', async: false })
class AssigneeIdListConstraint implements ValidatorConstraintInterface {
  validate(values: unknown): boolean {
    if (!Array.isArray(values)) return false;
    return values.every((value) => value === 'null' || UUID_V7.test(String(value)));
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be UUIDv7 values or the literal null`;
  }
}

/**
 * Whitelisted list query for board tasks.
 * Bracket keys (`dueDate[gte]`) are real query param names per api-conventions.
 */
export class TaskQueryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => toStringList(value))
  @IsEnum(Priority, { each: true })
  priority?: Priority[];

  /**
   * Assignee user ids (OR), or the literal `null` for unassigned.
   * Mixed `null` + ids means unassigned OR those assignees.
   */
  @IsOptional()
  @Transform(({ value }) => toStringList(value))
  @Validate(AssigneeIdListConstraint)
  assigneeId?: string[];

  @IsOptional()
  @Transform(({ value }) => toStringList(value))
  @IsUUID('7', { each: true })
  labelId?: string[];

  /** Only the string `null` — tasks with no due date. Ranges use bracket keys. */
  @IsOptional()
  @Equals('null')
  dueDate?: string;

  @IsOptional()
  @IsISO8601()
  'dueDate[gte]'?: string;

  @IsOptional()
  @IsISO8601()
  'dueDate[lte]'?: string;

  /**
   * Whitelisted sort tokens (`field` or `-field`, comma-separated).
   * Pagination always walks by `id`; board clients ignore this for canvas order.
   */
  @IsOptional()
  @IsString()
  @Matches(/^-?(position|createdAt|dueDate|priority)(,-?(position|createdAt|dueDate|priority))*$/)
  sort?: string;
}
