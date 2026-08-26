import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ColumnCategory } from '@kurul/shared-types';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';
import { MAX_COLUMN_NAME_LENGTH } from './column-limits';

export class UpdateColumnDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COLUMN_NAME_LENGTH)
  name?: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  /**
   * Non-nullable: a column always has a category. Clearing one back to "unknown" is not a
   * state the metrics layer has an answer for, so the client picks a value or omits the field.
   */
  @OptionalNonNullable()
  @IsEnum(ColumnCategory)
  category?: ColumnCategory;
}
