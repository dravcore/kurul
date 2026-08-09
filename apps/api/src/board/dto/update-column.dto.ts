import { IsString, MaxLength, MinLength } from 'class-validator';
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
}
