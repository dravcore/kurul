import { IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';
import { MAX_BOARD_DESCRIPTION_LENGTH, MAX_BOARD_NAME_LENGTH } from './board-limits';

export class UpdateBoardDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BOARD_NAME_LENGTH)
  name?: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(MAX_BOARD_DESCRIPTION_LENGTH)
  description?: string | null;
}
