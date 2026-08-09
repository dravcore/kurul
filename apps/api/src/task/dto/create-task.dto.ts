import { Priority } from '@kurultay/shared-types';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OptionalNullable } from '../../common/validation/optional';
import { MAX_ESTIMATED_MINUTES } from './task-limits';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsUUID('7')
  columnId!: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  /** Omit to fall back to the column default (`Priority.MEDIUM`). */
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @OptionalNullable()
  @IsISO8601({ strict: true, strictSeparator: true })
  dueDate?: string | null;

  /** Kept separate from `dueDate` — an estimate is effort, a due date is a deadline. */
  @OptionalNullable()
  @IsInt()
  @Min(0)
  @Max(MAX_ESTIMATED_MINUTES)
  estimatedMinutes?: number | null;

  /** Insert after this task in the target column; omit to append. */
  @IsOptional()
  @IsUUID('7')
  afterTaskId?: string | null;
}
