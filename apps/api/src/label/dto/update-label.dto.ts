import { LabelColorSlot } from '@kurultay/shared-types';
import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateLabelDto {
  /** Omitted = leave unchanged; explicit null is rejected (non-nullable column). */
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsEnum(LabelColorSlot)
  color?: LabelColorSlot;
}
