import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsUUID('7')
  columnId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  /** Insert after this task in the target column; omit to append. */
  @IsOptional()
  @IsUUID('7')
  afterTaskId?: string | null;
}
