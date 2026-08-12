import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { OptionalNonNullable } from '../../common/validation/optional';

export class UpdateWorkspaceDto {
  @OptionalNonNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @OptionalNonNullable()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with optional hyphens',
  })
  slug?: string;
}
