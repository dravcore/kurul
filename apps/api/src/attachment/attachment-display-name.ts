/**
 * The display-name rule for attachments, whatever wrote the row.
 *
 * Its own file rather than a private of `AttachmentService`, because the service is not the only
 * writer of `Attachment.filename`: the Trello importer (`import/trello-import-planner.ts`) writes
 * LINK rows from names it read out of somebody else's export, and it must apply exactly the rule
 * `createLink` applies. Sharing the function is what keeps "the stored name is safe to render" a
 * property of the column rather than of whichever code path happened to insert the row.
 */

/**
 * Everything that must not survive into a stored display name, in one class.
 *
 * Three groups, each load-bearing for a different reason:
 *
 *   * `"` and `\`: the two characters that close `Content-Disposition`'s quoted parameter
 *     early. This string is later written into that header (D8).
 *   * **C0 and C1 controls**, which subsume the CR and LF the first version named explicitly,
 *     and also cover the rest of the range: a tab or an `ESC` in a name is never anything a
 *     client meant, and `ESC` specifically is an escape sequence in any log or terminal the
 *     name is ever echoed to.
 *   * **The Unicode bidi overrides**: U+200E/U+200F, U+061C, U+202A-U+202E and the isolates
 *     U+2066-U+2069. These are the group that was missing, and the one with a real attack:
 *     `invoice‮gnp.exe` *renders* as `invoiceexe.png` in the panel and in the browser's own
 *     download prompt, because U+202E reverses everything after it. Measured through the real
 *     upload path before the fix: the character reached the row, the DTO and the
 *     `filename*=UTF-8''…` parameter untouched, so the save dialog showed the reversed name.
 *     Nothing else in the pipeline would have caught it; the ASCII half of the header maps it
 *     to `_`, which is exactly why the RFC 5987 half is where it survived.
 *
 * Nothing here is about paths. Traversal is unexpressible rather than filtered (the key comes
 * from the row's own UUIDv7, K9); the basename is kept in `displayFilename` because
 * `../../../../etc/passwd` shown as a filename is a phishing surface, and a name is a name.
 */
const UNSAFE_DISPLAY_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the control range is the point, not an oversight.
  /["\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * The display name for any attachment, whatever wrote it.
 *
 * Both kinds go through this. A LINK's label never reaches a `Content-Disposition` (the byte
 * stream answers 404 for a LINK), but it reaches the same panel, and the bidi override reads the
 * same way there. Applying the rule to one kind and not the other would make "the stored name is
 * safe to render" a claim that depends on which branch created the row.
 */
export function safeDisplayName(value: string): string {
  return value.replace(UNSAFE_DISPLAY_CHARACTERS, '').trim().slice(0, 255);
}

/**
 * The name shown next to a FILE attachment.
 *
 * The basename, cleaned, with a fallback for the name that was made entirely of characters the
 * class above removes.
 */
export function displayFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? '';
  const cleaned = safeDisplayName(base);
  return cleaned === '' ? 'attachment' : cleaned;
}
