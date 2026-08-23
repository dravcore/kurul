import type { CreatePersonalAccessTokenRequest } from '@kurul/shared-types';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { OptionalNullable } from '../../common/validation/optional';

export class CreateTokenDto implements CreatePersonalAccessTokenRequest {
  /** A label for the owner's own list: the script, machine or purpose the token serves. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  /**
   * When the token stops working, or absent / `null` for never. Must be in the future; the
   * service answers `400` for an instant that has already passed, since a token born expired
   * can only be a client mistake.
   */
  @OptionalNullable()
  @IsISO8601({ strict: true, strictSeparator: true })
  expiresAt?: string | null;
}
