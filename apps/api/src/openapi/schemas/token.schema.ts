import type { CreatedPersonalAccessTokenDto, PersonalAccessTokenDto } from '@kurul/shared-types';

/**
 * A personal access token as its owner sees it afterwards: identity, label, display prefix and
 * dates. Never the secret.
 */
export class PersonalAccessTokenSchema implements PersonalAccessTokenDto {
  id!: string;
  workspaceId!: string;
  userId!: string;
  /** The label chosen at creation. */
  name!: string;
  /**
   * `kurul_pat_` plus the first eight characters of the secret. Enough to recognise a token in
   * a list or a log line, useless as a credential.
   */
  prefix!: string;
  /** ISO 8601 UTC, or `null` while the token has never authenticated a request. */
  lastUsedAt!: string | null;
  /** ISO 8601 UTC, or `null` for a token that does not expire. */
  expiresAt!: string | null;
  /** ISO 8601 UTC. */
  createdAt!: string;
}

/** The create response, and the only response in the API that carries a token's plaintext. */
export class CreatedPersonalAccessTokenSchema
  extends PersonalAccessTokenSchema
  implements CreatedPersonalAccessTokenDto
{
  /**
   * The secret, shown exactly once. The server stores only its SHA-256 and cannot show it
   * again; a client that loses it revokes this token and creates another.
   */
  token!: string;
}
