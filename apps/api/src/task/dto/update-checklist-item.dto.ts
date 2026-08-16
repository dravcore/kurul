import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}
