import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** The two things that may become of a workspace whose only OWNER is leaving. */
export const WORKSPACE_DISPOSITION_ACTIONS = ['transfer', 'delete'] as const;
export type WorkspaceDispositionAction = (typeof WORKSPACE_DISPOSITION_ACTIONS)[number];

/**
 * Upper bound on how many workspaces one deletion may decide about.
 *
 * Not a product rule — nobody is the sole owner of two hundred workspaces — but a bound on the
 * work a single request can commission, since each `delete` disposition is a cascading delete
 * of an entire tenant. `ValidationPipe` walks the array before any of it runs, so the ceiling
 * costs nothing and the refusal is a `400` rather than a transaction that takes a minute.
 */
export const MAX_WORKSPACE_DISPOSITIONS = 200;

export class WorkspaceDispositionDto {
  @IsUUID('7')
  workspaceId!: string;

  @IsIn(WORKSPACE_DISPOSITION_ACTIONS)
  action!: WorkspaceDispositionAction;

  /**
   * Required for `transfer`, refused for `delete`.
   *
   * `ValidateIf` on the action rather than `@IsOptional()`: a body that says `delete` and also
   * names a new owner is not a `delete` request with a harmless extra field, it is a request
   * whose author believed two different things. `whitelist: true` strips unknown keys but not
   * declared ones, so this is what makes the union actually exclusive.
   */
  @ValidateIf((dto: WorkspaceDispositionDto) => dto.action === 'transfer')
  @IsUUID('7')
  newOwnerUserId?: string;
}

/**
 * Body for `DELETE /me` and `DELETE /instance/users/:userId`.
 *
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 */
export class DeleteAccountDto {
  /**
   * The address of the account being deleted, typed back by the caller.
   *
   * A misclick gate and documented as nothing more: the session sending this can already delete
   * every workspace the user owns, so a password re-prompt here and nowhere else would buy no
   * security while implying it had (ADR 0026 §4). On the administrator path it is the operator
   * confirming *which* account they mean, which is the failure worth guarding — an id in a URL
   * is unreadable and a mistyped one is another person.
   */
  @IsEmail()
  confirmEmail!: string;

  /**
   * One entry per workspace the user is the only OWNER of. Omitted is the same as empty, and
   * both are refused with `409` when there is any such workspace.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WORKSPACE_DISPOSITIONS)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceDispositionDto)
  dispositions?: WorkspaceDispositionDto[];
}
