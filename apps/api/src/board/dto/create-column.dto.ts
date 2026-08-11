import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class CreateColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUuidV7()
  afterColumnId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}
