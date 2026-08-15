import { INLINE_MIME_TYPES } from './attachment-mime';

/**
 * The `Content-Disposition` value for a stored file.
 *
 * `attachment` by default; `inline` only for the four image types (K4 / ADR 0024). PDFs are not
 * inline: `frame-src 'none'` and `object-src 'none'` on the web origin make an in-modal document
 * viewer impossible anyway, so an inline PDF would be a top-level navigation to attacker-supplied
 * bytes and nothing more.
 *
 * The filename is written twice, per RFC 5987: an ASCII-only `filename=` every client
 * understands, and a `filename*=UTF-8''…` for the real one. `"`, `\`, CR and LF are removed
 * before either — this is the one place a stored string reaches a response header, so it is the
 * one place header injection could exist.
 *
 * **CR and LF are held by two mechanisms, not one, and that was measured rather than assumed.**
 * Removing the strip below does not turn the injection test red: the ASCII substitution maps
 * both characters to `_`, and `encodeURIComponent` percent-encodes them in the RFC 5987
 * parameter. Only removing *both* lets a CRLF through. So the strip is load-bearing for `"` and
 * `\` — which is what would close the quoted parameter early — while CR/LF survive either half
 * alone. Written down because a reader deleting one line will find every test still green
 * (`displayFilename` in `attachment.service.ts` already dropped the same characters at write
 * time, which is a third layer and covers only rows written through the upload path).
 */
export function contentDisposition(mimeType: string, filename: string): string {
  const kind = INLINE_MIME_TYPES.has(mimeType) ? 'inline' : 'attachment';
  const safe = filename.replace(/[\r\n"\\]/g, '');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_') || 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
