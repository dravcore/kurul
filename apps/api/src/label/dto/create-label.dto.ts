import { LabelColorSlot } from '@kurultay/shared-types';
import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLabelDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsEnum(LabelColorSlot)
  color!: LabelColorSlot;
}
