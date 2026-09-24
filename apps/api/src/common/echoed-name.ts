/**
 * The longest name of the client's choosing an error message repeats whole, in characters as
 * `String.length` counts them, which is the unit multer checks `limits.fieldNameSize` in.
 */
const ECHOED_NAME_MAX_LENGTH = 64;

/**
 * The longest request path an error envelope repeats whole, in the same unit.
 *
 * Above every path the API serves, so none is ever shortened. The longest route in
 * `apps/api/openapi.json`, which lists every route the Nest router owns, is
 * `/workspaces/{workspaceId}/tasks/{taskId}/checklist-items/{itemId}/position`: 153 characters
 * with its three UUIDs filled in. The Better Auth mount, which the document leaves out, serves
 * nothing longer than `/auth/reset-password/<token>`, 45 characters with Better Auth's 24-character
 * token. 256 leaves room for a route one id deeper than today's deepest. The cut is for a path
 * nothing routes, which Node's 16 KiB limit on a request's head bounds and nothing else.
 */
const ECHOED_PATH_MAX_LENGTH = 256;

/**
 * `value` whole up to `maxLength` characters, and past that the first `maxLength` followed by
 * `[+N more]`: the one cut both bounds below share.
 */
function echoed(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const cut = value.slice(0, maxLength);
  // Never half a surrogate pair: `JSON.stringify` would write the orphan out as a bare `\ud83d`.
  const last = cut.charCodeAt(cut.length - 1);
  const head = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${head}[+${value.length - head.length} more]`;
}

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
  return echoed(name, ECHOED_NAME_MAX_LENGTH);
}

/**
 * The path of a request as an error envelope repeats it back: the request target up to its query
 * string or fragment, whole up to 256 characters and past that cut as `echoedName` cuts a name.
 *
 * `docs/api-conventions.md` defines the envelope's `path` as the request path, and the filter and
 * the Better Auth mount wrote the whole request URL there instead. A query string is the client's
 * own input, and nothing in it helps a client that already sent it: it can carry a token from a
 * link (`?token=`), which the envelope then repeats to wherever the client shows or logs its
 * errors, and it is as long as Node lets a request's head be. Measured through the stack
 * `configureApp` installs, a 16,000-character query key sent to a route that does not exist came
 * back twice, in `path` and in Nest's `Cannot GET <url>`, as a 32,174-byte envelope. The access
 * log for the same request wrote `/nope`: it has always dropped the query
 * (`access-log.middleware.ts`), so the two now agree, and the `requestId` both carry joins them.
 *
 * Cut at the first `?` or `#`, whichever comes first, which is the pathname Express routes on:
 * its `parseurl` stops at `?`, and hands a target holding a `#` to `url.parse`, whose pathname
 * stops there as well. No browser sends a `#`, but Node passes one through in the request line
 * (measured: `GET /probe/list#frag` reached the `/probe/list` handler). An absolute-form target
 * (`GET http://host/path`), which only a proxy or a hand-written request sends, keeps its scheme
 * and host, as the access log keeps them.
 *
 * `AllExceptionsFilter`, the Better Auth mount and the origin check all write `path` with this,
 * so an envelope reads the same whichever of them wrote it.
 */
export function echoedPath(url: string): string {
  const end = url.search(/[?#]/);
  return echoed(end === -1 ? url : url.slice(0, end), ECHOED_PATH_MAX_LENGTH);
}
