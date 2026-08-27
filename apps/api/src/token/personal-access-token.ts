import { createHash, randomBytes } from 'node:crypto';

/**
 * The fixed head of every personal access token.
 *
 * A recognisable prefix is what lets a secret scanner (GitHub's, a pre-commit hook, an
 * operator grepping a log dump) flag a leaked token without knowing anything about Kurul, and
 * what lets `SessionAuthGuard` decide in one string comparison whether an `Authorization`
 * header is ours to resolve or somebody else's credential sent to the wrong host.
 */
export const PERSONAL_ACCESS_TOKEN_PREFIX = 'kurul_pat_';

/**
 * Random bytes behind each token: 32 bytes is 256 bits, encoded below as 43 base64url
 * characters. Nothing about the token is derived from the user, the workspace or the clock, so
 * a token reveals nothing about who owns it until the database says so.
 */
const SECRET_BYTES = 32;

/** How many characters of the secret the owner sees again after creation, in `prefix`. */
const DISPLAY_PREFIX_LENGTH = 8;

/** A freshly minted plaintext token and the two derived values that are stored instead of it. */
export interface MintedToken {
  /** The full secret. Shown to the creator once; never written anywhere. */
  plaintext: string;
  /** SHA-256 of `plaintext`, hex. The only form the database ever holds. */
  hash: string;
  /** `kurul_pat_` + the first eight secret characters, for the owner's list. */
  prefix: string;
}

/**
 * SHA-256 rather than bcrypt or argon2, and that is the right call for this secret and the
 * wrong one for a password. A slow hash defends a low-entropy secret against offline guessing;
 * a token is 256 random bits, so there is nothing to guess and the slow hash would only add a
 * hundred milliseconds to every API request. A fast, unkeyed hash also keeps the lookup a
 * single indexed equality on `tokenHash`, and the bit of the threat model that matters, a
 * database dump not yielding usable credentials, is fully covered: nobody inverts SHA-256 of
 * 256 random bits.
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function displayPrefixOf(plaintext: string): string {
  return plaintext.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH);
}

export function mintToken(): MintedToken {
  const plaintext = PERSONAL_ACCESS_TOKEN_PREFIX + randomBytes(SECRET_BYTES).toString('base64url');
  return { plaintext, hash: hashToken(plaintext), prefix: displayPrefixOf(plaintext) };
}

/**
 * Pulls a Kurul token out of an `Authorization` header, or says there is none.
 *
 * Three answers rather than two on purpose. `absent` means the request carries no Bearer
 * credential at all and the cookie path should decide it. `invalid` means the client sent a
 * Bearer credential this API cannot possibly honour (wrong scheme layout, empty, or not a
 * `kurul_pat_` token) and must get `401` now, not a silent fallback to whatever cookie the
 * request also happens to carry: a client that sends a token expects that token to be the
 * identity the request runs under.
 */
export type BearerParse =
  { kind: 'absent' } | { kind: 'invalid' } | { kind: 'token'; plaintext: string };

export function parseBearerHeader(header: string | string[] | undefined): BearerParse {
  if (header === undefined) return { kind: 'absent' };
  // Node folds repeated headers into one string for `authorization`, but the type allows an
  // array and a duplicated credential is not a request this API should guess about.
  if (Array.isArray(header)) return { kind: 'invalid' };

  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const plaintext = match?.[1];
  if (!plaintext) return { kind: 'invalid' };

  if (!plaintext.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)) return { kind: 'invalid' };
  if (plaintext.length <= PERSONAL_ACCESS_TOKEN_PREFIX.length) return { kind: 'invalid' };

  return { kind: 'token', plaintext };
}
