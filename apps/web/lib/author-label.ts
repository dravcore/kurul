/** The half of an author DTO this rule needs: what they are called, and whether they still are. */
export interface LabelledAuthor {
  name: string;
  deleted: boolean;
}

/**
 * What to print where an author's name goes.
 *
 * A deleted account's `name` column holds the English string `Deleted user`, because the
 * database is where an API consumer that is not this app has to find something readable. That
 * makes it a **tombstone, not presentation** — and rendering it verbatim would put two English
 * words inside a Turkish comment thread, which is the same hole ADR 0018 and the Turkish pass
 * exist to close, arriving through a different door. It is also the hole most likely to be found
 * by a user rather than by us, because it only appears once somebody has actually left.
 *
 * So the label is chosen here, off the boolean, and the stored value is never rendered.
 *
 * **`deletedLabel` is a resolved string rather than a bound translator**, which is the second
 * design this function had. Passing `t` kept the key literal inside this module, and
 * `messages/catalog.test.ts` refuses to treat a dotless literal in a helper as evidence that a
 * key is live — correctly, since `'deletedUser'` sitting here would otherwise vouch for every
 * `*.deletedUser` key any namespace ever grows. Taking the string means the namespace and the
 * key sit together at the call site, where the scanner can see them and where they are in fact
 * used. The rule itself still lives in exactly one place, which was the point of the helper.
 *
 * Note what this does **not** try to localise: the display name bound inside a comment's mention
 * markup (`@[Deleted user](<id>)`). That is stored text in `Comment.body`, written once at
 * anonymisation time with no reader's locale in scope, and it stays English by necessity — see
 * `docs/decisions/0026-account-deletion-anonymisation.md`. The inconsistency is real and stated
 * rather than quiet.
 */
export function authorLabel(author: LabelledAuthor, deletedLabel: string): string {
  return author.deleted ? deletedLabel : author.name;
}
