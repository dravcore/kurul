/**
 * Longest display name a stored mention can carry, mirroring `parse-mentions.ts`.
 *
 * The bound is what keeps the pattern linear rather than quadratic on a body full of unclosed
 * `@[` runs — the same reasoning, stated there at length. Repeated rather than imported
 * because the two constants answer different questions (what the picker may *bind* versus what
 * a stored body may *contain*) and a shared constant would make a future change to one silently
 * change the other.
 */
const MAX_MENTION_NAME = 200;

/** Escapes a value for literal use inside a `RegExp`. */
function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The name every mention of an anonymised account is rewritten to.
 *
 * Matches `ANONYMOUS_USER_NAME` in `account/anonymised-user.ts`, and does so by importing it
 * would be circular the wrong way round — this module is in `common/` and knows nothing about
 * accounts, so the caller passes the replacement in. The default exists only so a caller
 * cannot accidentally redact to an empty string.
 */
export const DEFAULT_MENTION_REDACTION = 'Deleted user';

/**
 * Rewrites the display name inside every `@[Name](userId)` mention of one user.
 *
 * This exists because a mention is **not** a join. The picker binds the name it saw into the
 * comment body at write time (`@[Ada Lovelace](0198…)`) so a comment renders without looking
 * anybody up, which means anonymising the `User` row does not touch a single byte of the
 * thousands of comments that spell the person's name out. An anonymisation that skips this
 * leaves the name exactly where people actually read it.
 *
 * The id half is preserved deliberately: the mention still resolves, still highlights, and
 * still says *that a specific person* was addressed — which is what keeps the surrounding
 * sentence readable. Only the name changes.
 *
 * Ids are matched case-insensitively, like `parseMentions`, and the pattern is anchored on the
 * exact id rather than on the UUIDv7 shape, so a body mentioning three people loses one name
 * and keeps two.
 */
export function redactMentionsOf(
  body: string,
  userId: string,
  replacement: string = DEFAULT_MENTION_REDACTION,
): string {
  const pattern = new RegExp(
    `@\\[[^\\]]{0,${MAX_MENTION_NAME}}\\]\\(${escapeForPattern(userId)}\\)`,
    'gi',
  );
  return body.replace(pattern, `@[${replacement}](${userId})`);
}
