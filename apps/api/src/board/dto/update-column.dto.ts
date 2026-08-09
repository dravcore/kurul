import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateColumnDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;
}
