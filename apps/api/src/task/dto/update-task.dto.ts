import { Priority } from '@kurultay/shared-types';
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
import { MAX_ESTIMATED_MINUTES } from './task-limits';

export class UpdateTaskDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(20_000)
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
