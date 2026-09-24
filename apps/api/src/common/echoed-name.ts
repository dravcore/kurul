/**
 * The longest name of the client's choosing an error message repeats whole, in characters as
 * `String.length` counts them, which is the unit multer checks `limits.fieldNameSize` in.
 */
const ECHOED_NAME_MAX_LENGTH = 64;

/**
 * A name the client chose, as an error message repeats it back: whole up to 64 characters, and
 * past that the first 64 followed by `[+N more]`.
 *
 * Two kinds of refusal name what they refuse, and in both the name is whatever the client sent,
 * bounded only by what carried it. A multipart part's name is limited by nothing but the 16 KiB
 * busboy allows a part's header block (`MAX_HEADER_SIZE`), since its `fieldNameSize` default
 * applies to urlencoded bodies alone: a 16,340-character name fits, and a refusal that named its
 * part came back as a 16,484-byte envelope (measured through `FileInterceptor`). A key in a JSON
 * body is limited by nothing but `REQUEST_BODY_MAX_BYTES`, and one in a query string by the
 * 16 KiB Node allows a request's head: `ValidationPipe` refuses an unknown key with
 * `property <name> should not exist` and puts the name in `field` as well, so a 20 KiB key came
 * back as a 41,239-byte envelope, and one filling the 1 MiB body as a 2 MiB one (measured through
 * the stack `configureApp` installs).
 *
 * `AllExceptionsFilter` bounds a part name with this and `validationExceptionFactory` a property
 * name and path, so the two kinds read the same. A name of 64 characters or fewer is never
 * touched, and the message is then word for word the library's own; 64 is also the
 * `limits.fieldNameSize` both multipart routes set, so no part name multer lets through is
 * shortened either.
 */
export function echoedName(name: string): string {
  if (name.length <= ECHOED_NAME_MAX_LENGTH) {
    return name;
  }

  const cut = name.slice(0, ECHOED_NAME_MAX_LENGTH);
  // Never half a surrogate pair: `JSON.stringify` would write the orphan out as a bare `\ud83d`.
  const last = cut.charCodeAt(cut.length - 1);
  const head = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${head}[+${name.length - head.length} more]`;
}
