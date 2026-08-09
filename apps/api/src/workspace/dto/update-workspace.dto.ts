import { IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateWorkspaceDto {
  /** Omitted = leave unchanged; explicit null is rejected (non-nullable column). */
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with optional hyphens',
  })
  slug?: string;
}
