import type { AttachmentDto, AttachmentKind } from '@kurultay/shared-types';

/**
 * One attachment on a task.
 *
 * `kind` says whether this row has stored bytes or only a URL, and it is never inferred from
 * which fields are `null`. The three FILE-only fields are `null` on a `LINK`; `url` is `null`
 * on a `FILE`.
 *
 * There is deliberately no download URL here — the client builds it from `id`, so no
 * deployment's origin is baked into a payload.
 */
export class AttachmentSchema implements AttachmentDto {
  id!: string;
  taskId!: string;
  kind!: AttachmentKind;
  /** Display name. For a FILE this is what the browser sent; it never appears in a path. */
  filename!: string;
  /** FILE only: the **sniffed** media type, never the one the client declared at upload. */
  mimeType!: string | null;
  /** FILE only: size in bytes. */
  size!: number | null;
  /** LINK only: an `http:`/`https:` URL the server has never requested and never will. */
  url!: string | null;
  uploadedById!: string;
  createdAt!: string;
}
