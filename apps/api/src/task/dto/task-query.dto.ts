import { Transform } from 'class-transformer';
import {
  Equals,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Priority } from '@kurultay/shared-types';
import { DEFAULT_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';
import { isUuidV7 } from '../../common/uuid';

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

@ValidatorConstraint({ name: 'assigneeIdList', async: false })
class AssigneeIdListConstraint implements ValidatorConstraintInterface {
  validate(values: unknown): boolean {
    if (!Array.isArray(values)) return false;
    return values.every((value) => value === 'null' || isUuidV7(value));
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
  @PageLimit()
  limit: number = DEFAULT_PAGE_LIMIT;

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
}
