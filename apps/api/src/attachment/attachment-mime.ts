import { UnsupportedMediaTypeException } from '@nestjs/common';

/**
 * ## How an ESM-only package works inside this CommonJS build
 *
 * `file-type@21` is ESM-only and `apps/api` ships as CommonJS, which normally means a build-time
 * problem. It is not one here, and the reason was measured on the compiled output rather than
 * reasoned about:
 *
 *   - `tsconfig.base.json` sets `module: NodeNext`, so `tsc` leaves the `await import(...)`
 *     below **as a real dynamic import** in `dist/attachment/attachment-mime.js` instead of
 *     downleveling it to `require`. A CommonJS module is allowed to `import()` an ESM one.
 *   - Loading `dist/attachment/attachment-mime.js` through `require` and calling `sniffMimeType`
 *     returns `image/png` for a PNG and `null` for HTML — the production path works.
 *   - This runtime is Node 24 (`engines: >=24`), which also supports plain `require(esm)`, so
 *     even the downleveled form would have resolved.
 *
 * What does *not* work is Jest: it runs CommonJS and asks the resolver for a `require`
 * condition, and `file-type`'s `exports` map offers only `import`/`module-sync`. That is why
 * `jest.config.cjs` carries a `moduleNameMapper` entry for this one specifier. The mapping is a
 * test-harness detail with no production counterpart — do not "fix" this import to match it.
 */

/**
 * What this instance accepts, read from the magic bytes and nothing else.
 *
 * Broad on purpose: a tool that refuses `.xlsx` because a strict reading of "safe types"
 * excluded it is a tool people stop trying to attach things to, and the audit ranked
 * attachments first among the gaps that end an evaluation (ADR 0024).
 *
 * `text/html` and `image/svg+xml` are the two deliberate exclusions, for one reason: images are
 * the single family served `inline`, and both of those are markup. Admitting SVG would not add
 * a file type — it would convert the inline-preview decision into stored XSS on the origin
 * ADR 0022 chose for its `default-src 'none'`. Sniffing rescues neither case, because both
 * files really are what they claim to be.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  // OpenXML. Every one of these is a ZIP container, which is why `application/zip` below is
  // convenient rather than accidental: `file-type` reports `application/zip` for a `.docx`
  // unless it inspects the archive's contents, so the fallback for an office document that
  // sniffs as a plain archive is an accepted type rather than a 415 at the user (ADR 0024).
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // OpenDocument.
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'text/plain',
  'text/csv',
]);

/** The four types served `inline`; everything else is `attachment` (ADR 0024). */
export const INLINE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * The two types that reach a row through `plainTextType` rather than through a magic number, and
 * therefore the two the download path gives an explicit `charset`. Neither is ever `inline`.
 */
export const TEXT_MEDIA_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/csv']);

/**
 * The media type of `bytes`, or `null` when nothing recognises them.
 *
 * `await import` rather than Nest's `FileTypeValidator`. That validator loads `file-type`
 * through `loadEsm` and, when the load throws, logs about it and then **returns `false`**
 * (`@nestjs/common/pipes/file/file-type.validator.js:96-111`) — so under this API's Jest
 * configuration a genuine PNG fails validation and the caller receives a 415 indistinguishable
 * from having attached the wrong thing. A misconfiguration wearing a user error's status code
 * is the failure this function exists to avoid: here a failed import throws, and a thrown
 * import is a 500 somebody investigates.
 */
export async function sniffMimeType(bytes: Buffer): Promise<string | null> {
  const { fileTypeFromBuffer } = await import('file-type');
  return (await fileTypeFromBuffer(bytes))?.mime ?? null;
}

/**
 * Returns the sniffed type, or throws the 415 the user's mistake deserves.
 *
 * `UnsupportedMediaTypeException` specifically, not a bare `Error`: multer's
 * `transformException` returns anything it does not recognise unchanged, so a plain `Error`
 * would reach `AllExceptionsFilter`'s `instanceof Error` branch and become a 500 reported to
 * Sentry — a user attaching the wrong file type logged as a server fault. A Nest HTTP exception
 * passes through untouched, and that is mechanical rather than hopeful: `transformException`
 * opens with `if (!error || error instanceof HttpException) return error` (ADR 0022).
 */
export async function assertAllowedMimeType(bytes: Buffer, declared: string): Promise<string> {
  const sniffed = await sniffMimeType(bytes);
  if (sniffed !== null) {
    if (!ALLOWED_MIME_TYPES.has(sniffed)) {
      throw new UnsupportedMediaTypeException('This file type is not accepted');
    }
    return sniffed;
  }
  const text = plainTextType(bytes, declared);
  if (text !== null) {
    return text;
  }
  throw new UnsupportedMediaTypeException('This file type is not accepted');
}

/**
 * The two declared types the fallback will consider. Nothing else opens this door, and the
 * return value below is one of *these two literals* rather than the caller's string — a free
 * copy of whatever arrived in `Content-Type` would put an attacker-chosen value into a response
 * header, which is a different bug wearing this function's clothes.
 */
const TEXT_DECLARATIONS = ['text/plain', 'text/csv'] as const;
type TextDeclaration = (typeof TEXT_DECLARATIONS)[number];

/**
 * The one narrow path by which bytes `file-type` cannot name are still accepted, and the type
 * they are accepted *as*.
 *
 * Plain text has no magic number, so a `.txt` or a `.csv` sniffs as `null` — and a `.csv` is the
 * typical companion of the Trello migration this whole phase exists to make possible. Leaving
 * them on the allowlist while rejecting them in practice would be a documented lie, so the
 * fallback exists; making it unconditional would mean "every buffer nothing recognises is
 * accepted", which admits `text/html` — the one exclusion K3 is most emphatic about. So it is
 * conditional, on four things at once, and each one is separately load-bearing:
 *
 *   1. **The caller declared one of exactly two types.** Not evidence on its own (nothing
 *      declared ever is), but it is what keeps this path from being reachable by an upload that
 *      claimed anything else — `text/html` fails here and never reaches the rest.
 *   2. **The buffer is valid UTF-8.** Text that is not decodable text is not text.
 *   3. **No NUL byte.** The clearest single signal separating "a format the sniffer does not
 *      know" from "a binary we have no name for".
 *   4. **It does not start with `<`.** Markup in a `.txt` must not become an accepted upload
 *      just because it is legal UTF-8 — this is the condition that keeps HTML and SVG out.
 *
 * **Why the declared label survives, and why that does not contradict the serving policy.** The
 * security verdict is made by conditions 2-4 and by condition 1's *membership test*, none of
 * which trust the declaration as evidence about the content — which is the thing ADR 0022
 * forbids. What the declaration does, and only after that verdict has been reached, is pick
 * between two labels that are already equally inert: `text/plain` and `text/csv` are both served
 * `attachment` with `nosniff`, so neither renders in a browser and the choice changes nothing
 * about safety. It changes one thing about honesty: a user who uploaded a `.csv` should not be
 * shown `text/plain`. **Validation is independent of the declaration; the label is applied after
 * validation.**
 *
 * And the second layer holds regardless: the file is stored and served with
 * `charset=utf-8`, `Content-Disposition: attachment` and `nosniff`, so even a document that
 * slipped past all four is downloaded rather than rendered. That is the defence
 * ADR 0022:118-126 already names; this function keeps it from being the *only* one.
 *
 * **Accepted cost:** the whole buffer is decoded, up to `ATTACHMENT_MAX_BYTES`. Reading only a
 * prefix would be cheaper and would defeat condition 3 — a NUL a megabyte in is exactly the case
 * a prefix check misses. Not measured; the upload-path measurement planned for this feature uses
 * a PDF and so does not exercise this branch.
 */
function plainTextType(bytes: Buffer, declared: string): TextDeclaration | null {
  // `?? ''` is unreachable — `split` always yields at least one element — but this project
  // typechecks with `noUncheckedIndexedAccess`, which does not know that.
  const label = (declared.split(';')[0] ?? '').trim().toLowerCase();
  // A membership test against two literals, never a copy of the caller's string: whatever this
  // returns is written to the row and later to a response header.
  const match = TEXT_DECLARATIONS.find((candidate) => candidate === label);
  if (match === undefined) return null;
  if (bytes.includes(0x00)) return null;

  // `fatal: true` is the whole check — a lossy decode would replace bad sequences with U+FFFD
  // and report success on any byte string at all.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  return text.trimStart().startsWith('<') ? null : match;
}
