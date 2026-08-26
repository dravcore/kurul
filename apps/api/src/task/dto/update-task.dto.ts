import { Priority } from '@kurul/shared-types';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';
import {
  MAX_ESTIMATED_MINUTES,
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_TITLE_LENGTH,
} from './task-limits';

export class UpdateTaskDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TASK_TITLE_LENGTH)
  title?: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(MAX_TASK_DESCRIPTION_LENGTH)
  description?: string | null;

  @OptionalNonNullable()
  @IsEnum(Priority)
  priority?: Priority;

  @OptionalNullable()
  @IsISO8601({ strict: true, strictSeparator: true })
  dueDate?: string | null;

  @OptionalNullable()
  @IsInt()
  @Min(0)
  @Max(MAX_ESTIMATED_MINUTES)
  estimatedMinutes?: number | null;
}
