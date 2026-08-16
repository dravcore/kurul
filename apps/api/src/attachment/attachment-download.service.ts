import { Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AttachmentKind } from '@kurul/shared-types';
import { StorageService } from '../storage/storage.service';
import { contentDisposition } from './attachment-disposition';
import { TEXT_MEDIA_TYPES } from './attachment-mime';
import { AttachmentService } from './attachment.service';

export interface AttachmentDownload {
  stream: Readable;
  headers: Record<string, string>;
}

/**
 * Everything the byte stream needs, resolved **before** a single byte exists.
 *
 * Authorization, existence, kind and the open all complete here. Once the controller starts
 * piping, a failure ends the response with `res.destroy()` and never reaches
 * `AllExceptionsFilter` — whose last line is an unconditional
 * `response.status(statusCode).json(problem)` (`all-exceptions.filter.ts:261`). Calling that
 * after headers are out raises `ERR_HTTP_HEADERS_SENT`, and the client silently receives a
 * truncated file while Sentry records a 500. This is the one error class the filter does not
 * cover, and it exists only because this is the first endpoint that answers with something
 * other than JSON (ADR 0022).
 *
 * Knows no `Request` and no `Response`: it returns a descriptor, and the controller writes it.
 * That keeps `docs/coding-standards.md:106` true for a handler that genuinely has to stream.
 */
@Injectable()
export class AttachmentDownloadService {
  constructor(
    private readonly attachments: AttachmentService,
    private readonly storage: StorageService,
  ) {}

  async open(workspaceId: string, attachmentId: string): Promise<AttachmentDownload> {
    const attachment = await this.attachments.findRow(workspaceId, attachmentId);
    if (attachment.kind !== AttachmentKind.File || attachment.storageKey === null) {
      // A LINK has no bytes. 404 rather than 400: the caller asked for a resource that does not
      // exist, and saying "wrong kind" would confirm the row does.
      throw new NotFoundException('Attachment not found');
    }

    const mimeType = attachment.mimeType ?? 'application/octet-stream';
    // Rejects before a stream exists — see DiskStorageBackend.createReadStream.
    const stream = await this.storage.createReadStream(attachment.storageKey);

    return {
      stream,
      headers: {
        // The stored type. For everything with a magic number that is the sniffed one, never
        // what the client declared (K4) — validating one value and shipping another would make
        // the allowlist advisory. `text/plain` and `text/csv` are the two the fallback puts
        // there, and they are the only ones that carry a charset: `plainTextType` already proved
        // the bytes decode as UTF-8, and without an explicit `charset` a browser guesses the
        // encoding of a `.csv` it was just handed. Both are served `attachment`, so neither
        // renders — the label is honest, not permissive.
        'Content-Type': TEXT_MEDIA_TYPES.has(mimeType) ? `${mimeType}; charset=utf-8` : mimeType,
        'Content-Length': String(attachment.size ?? 0),
        'Content-Disposition': contentDisposition(mimeType, attachment.filename),
        // Without this, a browser that disagrees with the declared type may render a `.png`
        // upload as HTML and the whole allowlist becomes advice.
        'X-Content-Type-Options': 'nosniff',
        // Overrides the `cross-origin` policy the API sets globally at
        // `common/configure-app.ts:46`. That policy exists because the web app is a legitimately
        // separate origin; the reasoning does not extend to user-uploaded bytes, which nothing
        // off-origin should be embedding.
        'Cross-Origin-Resource-Policy': 'same-origin',
        // `private` keeps every shared cache out, including a CDN an operator puts in front of
        // the proxy. `max-age=0, must-revalidate` is what stops a removed member's browser from
        // serving the file out of its own cache — ADR 0022 deferred signed URLs, so there is no
        // revocable token to lean on instead.
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    };
  }
}
