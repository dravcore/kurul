import { IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';

export class UpdateBoardDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
