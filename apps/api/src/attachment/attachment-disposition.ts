import { INLINE_MIME_TYPES } from './attachment-mime';

/**
 * Everything stripped before either parameter is written.
 *
 * Three groups, and they are not redundant with one another:
 *
 *   * `"` and `\` — the two characters that close the quoted parameter early. This is what
 *     the strip is load-bearing for on its own.
 *   * **C0/C1 controls**, which subsume the CR and LF a header injection would need, and cover
 *     the rest of the range while they are at it.
 *   * **The bidi overrides** — U+200E/U+200F, U+061C, U+202A-U+202E, U+2066-U+2069. These are
 *     the group the ASCII substitution below does *not* already handle, and the RFC 5987 half
 *     is why: `encodeURIComponent` percent-encodes U+202E quite happily and the browser decodes
 *     it again when it draws the save dialog, so a stored name ending `<RLO>gnp.exe` was
 *     offered to the user as `exe.png`. Measured through the real download path before this
 *     class existed; `attachment.service.ts` carries the write-side half of the same fix.
 *
 * **CR and LF are held by two mechanisms, not one, and that was measured rather than assumed.**
 * Removing this strip does not turn the injection test red: the ASCII substitution maps both
 * characters to `_`, and `encodeURIComponent` percent-encodes them in the RFC 5987 parameter.
 * Only removing *both* lets a CRLF through. Written down because a reader deleting one line
 * will find every test still green. The bidi group is the opposite case — it has exactly one
 * mechanism here, so deleting it from this class *is* visible in a test.
 *
 * `attachment.service.ts` strips the same class at write time. That is a second layer and it
 * covers only rows written through the upload path; an importer, or a row written directly,
 * reaches here without having passed it.
 */
const UNSAFE_HEADER_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the control range is the point, not an oversight.
  /["\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * The `Content-Disposition` value for a stored file.
 *
 * `attachment` by default; `inline` only for the four image types (K4 / ADR 0024). PDFs are not
 * inline: `frame-src 'none'` and `object-src 'none'` on the web origin make an in-modal document
 * viewer impossible anyway, so an inline PDF would be a top-level navigation to attacker-supplied
 * bytes and nothing more.
 *
 * The filename is written twice, per RFC 5987: an ASCII-only `filename=` every client
 * understands, and a `filename*=UTF-8''…` for the real one. `UNSAFE_HEADER_CHARACTERS` goes
 * before either — this is the one place a stored string reaches a response header, so it is the
 * one place header injection could exist.
 */
export function contentDisposition(mimeType: string, filename: string): string {
  const kind = INLINE_MIME_TYPES.has(mimeType) ? 'inline' : 'attachment';
  const safe = filename.replace(UNSAFE_HEADER_CHARACTERS, '');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_') || 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
