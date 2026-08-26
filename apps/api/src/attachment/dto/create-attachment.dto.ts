import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AttachmentKind } from '@kurul/shared-types';
import { MAX_ATTACHMENT_URL_LENGTH } from './attachment-limits';

/**
 * The body of `POST .../attachments`, for both shapes it accepts.
 *
 * `kind` is carried explicitly rather than inferred from whether a file arrived. A request with
 * neither a file nor a URL is otherwise ambiguous, and the best error such a handler could
 * produce is "I could not tell what you meant to send" — which is a worse contract than asking
 * the caller to say (ADR 0024's single-endpoint decision, plan decision D7).
 *
 * Multipart text fields arrive as strings, so every constraint here has to hold for a string;
 * that is why there is no numeric field and no boolean.
 */
export class CreateAttachmentDto {
  @IsEnum(AttachmentKind)
  kind!: AttachmentKind;

  /**
   * LINK only. The scheme allowlist is enforced in the service rather than by a decorator: the
   * rule is "http or https and nothing else" and `@IsUrl` accepts a much longer list, so the
   * check that matters would sit somewhere other than the check that reads as if it matters.
   */
  @ValidateIf((dto: CreateAttachmentDto) => dto.kind === AttachmentKind.Link)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ATTACHMENT_URL_LENGTH)
  url?: string;

  /**
   * Display name. Optional for a FILE (the multipart part carries one) and optional for a LINK
   * (the URL is shown when it is missing). Never a path segment — see K9.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}
