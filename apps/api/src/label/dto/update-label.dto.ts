import { LabelColorSlot } from '@kurul/shared-types';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalNonNullable } from '../../common/validation/optional';
import { MAX_LABEL_NAME_LENGTH } from './label-limits';

export class UpdateLabelDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_LABEL_NAME_LENGTH)
  name?: string;

  @OptionalNonNullable()
  @IsEnum(LabelColorSlot)
  color?: LabelColorSlot;
}
