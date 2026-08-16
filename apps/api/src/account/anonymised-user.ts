/**
 * What is left of an account after an erasure request, and how it is derived.
 *
 * The `User` row is never deleted — seven `Restrict` foreign keys reference it and each one is
 * a decision that the content outlives its author — so "deleting an account" means rewriting
 * the columns that identify a person and leaving the id that makes their content readable.
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 */

/**
 * The display name every anonymised account carries.
 *
 * Stored in `User.name`, so it is rendered by every surface that renders a member — comment
 * headers, the activity feed — with no branch anywhere. **It is stored English text and is not
 * translated;** ADR 0026 records that as a known gap and the trigger for closing it (threading
 * `deletedAt` through the author DTOs so the web can substitute a localised label).
 */
export const ANONYMOUS_USER_NAME = 'Deleted user';

/**
 * The reserved domain the replacement address lives in.
 *
 * RFC 2606 §2 reserves `.invalid` for exactly this: a name guaranteed never to resolve, so the
 * address cannot be routed to, cannot be registered by anybody, and cannot collide with a real
 * mailbox on any instance.
 */
const ANONYMOUS_EMAIL_DOMAIN = 'deleted.invalid';

/**
 * The address that replaces the user's own, derived from `User.id`.
 *
 * **Not a hash of the old address**, which is the one place this design departs from the
 * audit's recommendation. A hash is checkable: anyone holding a list of addresses can hash them
 * and confirm which ones had accounts on this instance, which is pseudonymisation rather than
 * anonymisation. The id is a UUIDv7 that is already written into every content row this design
 * keeps — so it discloses nothing the rows do not already disclose — and nothing inverts it
 * back to an address.
 *
 * Unique by construction, because `User.id` is: the `@unique` on `email` still holds, and the
 * person's real address is freed for a fresh sign-up.
 */
export function anonymisedEmailFor(userId: string): string {
  return `deleted-${userId}@${ANONYMOUS_EMAIL_DOMAIN}`;
}

/** The full column set an erasure request writes over the `User` row. */
export function anonymisedUserFields(
  userId: string,
  deletedAt: Date,
): {
  email: string;
  name: string;
  emailVerified: boolean;
  avatarUrl: null;
  locale: null;
  deletedAt: Date;
} {
  return {
    email: anonymisedEmailFor(userId),
    name: ANONYMOUS_USER_NAME,
    // The address is gone, so the claim that it was confirmed is meaningless — and leaving it
    // true would let a tombstone satisfy `requireEmailVerificationOnInvitation` if it ever
    // reached that path.
    emailVerified: false,
    avatarUrl: null,
    locale: null,
    deletedAt,
  };
}
