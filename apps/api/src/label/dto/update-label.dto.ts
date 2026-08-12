import { LabelColorSlot } from '@kurultay/shared-types';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalNonNullable } from '../../common/validation/optional';

export class UpdateLabelDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @OptionalNonNullable()
  @IsEnum(LabelColorSlot)
  color?: LabelColorSlot;
}
