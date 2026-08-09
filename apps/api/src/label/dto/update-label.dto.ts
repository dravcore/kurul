import { LabelColorSlot } from '@kurultay/shared-types';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateLabelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsEnum(LabelColorSlot)
  color?: LabelColorSlot;
}
