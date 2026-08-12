import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ColumnCategory } from '@kurultay/shared-types';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';

export class UpdateColumnDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
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
