import 'reflect-metadata';
import { Readable, Writable } from 'node:stream';
import type { Response } from 'express';
import {
  ATTACHMENT_DOWNLOAD_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
} from '../common/rate-limit/rate-limit';
import { AttachmentController } from './attachment.controller';
import { AttachmentDownloadService } from './attachment-download.service';
import { AttachmentService } from './attachment.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const ATTACHMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

/** A writable that behaves like the response object the handler is handed. */
class FakeResponse extends Writable {
  readonly set = jest.fn();
  readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    done();
  }
}

function build(stream: Readable) {
  const attachments = {} as unknown as AttachmentService;
  const downloads = {
    open: jest.fn().mockResolvedValue({ stream, headers: { 'Content-Type': 'application/pdf' } }),
  } as unknown as AttachmentDownloadService;
  const res = new FakeResponse();
  return {
    controller: new AttachmentController(attachments, downloads),
    downloads,
    res,
  };
}

/** Lets the stream machinery run its queued events. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('AttachmentController.content', () => {
  it('writes the resolved headers and only then starts the stream', async () => {
    const { controller, res } = build(Readable.from(['bytes']));

    await controller.content(WORKSPACE_ID, ATTACHMENT_ID, res as unknown as Response);
    await settle();

    expect(res.set).toHaveBeenCalledWith({ 'Content-Type': 'application/pdf' });
    expect(Buffer.concat(res.chunks).toString()).toBe('bytes');
  });

  it('destroys the response instead of writing an error body once the stream has failed', async () => {
    // `AllExceptionsFilter` ends with an unconditional `response.status(code).json(problem)`.
    // Reaching that after the headers are out raises ERR_HTTP_HEADERS_SENT, and the client
    // silently receives a truncated file while Sentry records a 500. This is the one error class
    // the filter cannot answer, so this handler answers it by ending the socket (ADR 0022).
    const failing = new Readable({
      read() {
        this.destroy(new Error('disk gone'));
      },
    });
    const { controller, res } = build(failing);
    const destroy = jest.spyOn(res, 'destroy');

    await controller.content(WORKSPACE_ID, ATTACHMENT_ID, res as unknown as Response);
    await settle();

    expect(destroy).toHaveBeenCalled();
    expect(res.chunks).toHaveLength(0);
  });

  it('lets a failure before the first byte reach the filter as an ordinary error', async () => {
    // Everything the stream needs is resolved while a JSON error is still writable, so this one
    // must *not* be swallowed into a destroyed socket.
    const { controller, downloads, res } = build(Readable.from(['bytes']));
    (downloads.open as jest.Mock).mockRejectedValue(new Error('not found'));

    await expect(
      controller.content(WORKSPACE_ID, ATTACHMENT_ID, res as unknown as Response),
    ).rejects.toThrow('not found');
    expect(res.set).not.toHaveBeenCalled();
  });

  it('serves the byte stream above the default rate limit, not below it', () => {
    const limit: unknown = Reflect.getMetadata(
      'THROTTLER:LIMIT' + 'default',
      AttachmentController.prototype.content,
    );

    expect(limit).toBe(ATTACHMENT_DOWNLOAD_RATE_LIMIT);
    // A panel with ten image attachments issues ten requests on open, so the default would be
    // spent on ordinary browsing (ADR 0022, plan decision D9).
    expect(ATTACHMENT_DOWNLOAD_RATE_LIMIT).toBeGreaterThan(DEFAULT_RATE_LIMIT);
  });
});
