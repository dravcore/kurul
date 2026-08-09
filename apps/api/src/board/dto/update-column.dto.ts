import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateColumnDto {
  /** Omitted = leave unchanged; explicit null is rejected (non-nullable column). */
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  color?: string | null;
}
