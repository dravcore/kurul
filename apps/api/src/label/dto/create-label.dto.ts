import { LabelColorSlot } from '@kurul/shared-types';
import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_LABEL_NAME_LENGTH } from './label-limits';

export class CreateLabelDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(MAX_LABEL_NAME_LENGTH)
  name!: string;

  @IsEnum(LabelColorSlot)
  color!: LabelColorSlot;
}
