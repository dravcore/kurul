import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID('7')
  afterColumnId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}
