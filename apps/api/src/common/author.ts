/**
 * The person behind a comment or an activity row, as every client reads them.
 *
 * Two services resolve an author — `CommentService` and `ActivityService` — and before this
 * existed they each carried their own copy of the `select` and their own object literal. That
 * was survivable while the shape was three fields that never change. It stopped being
 * survivable when `deleted` arrived: a mapper that forgets it does not fail to compile against
 * a `boolean` it simply never sets — it fails at the type level only because the field is
 * required, and the moment somebody satisfies the compiler with `deleted: false` in one place
 * and computes it properly in the other, the two feeds disagree about whether a person still
 * exists. One selector and one mapper is what makes that impossible.
 *
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 */

/** Columns an author needs. `deletedAt` is read here and never leaves this module. */
export const AUTHOR_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  deletedAt: true,
} as const;

/** The row shape {@link AUTHOR_SELECT} produces. */
export interface AuthorRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  deletedAt: Date | null;
}

/** What a client receives: the same three fields, plus whether the account is a tombstone. */
export interface AuthorDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  deleted: boolean;
}

/**
 * Narrows an author row to what a client may read.
 *
 * **The timestamp is collapsed to a boolean here, and that is the point of the function.**
 * Both callers are `@WorkspaceScoped()` routes, so every member down to GUEST reads the result,
 * and `docs/architecture.md`'s rule is that a payload must never widen who can see something.
 * *When* a named individual asked to be erased is a fact about that person that nothing on
 * either screen needs; whether they are gone is the whole of what a client legitimately acts
 * on. Returning `deletedAt` would have been one character cheaper and would have published a
 * per-person date to the entire workspace.
 *
 * `name` is passed through unchanged — it already reads `Deleted user` for a tombstone, because
 * an API consumer that is not this web app still needs something in the field. The web
 * substitutes a translated label off `deleted`; the stored value is a tombstone, not
 * presentation.
 */
export function toAuthorDto(row: AuthorRow): AuthorDto {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    deleted: row.deletedAt !== null,
  };
}
