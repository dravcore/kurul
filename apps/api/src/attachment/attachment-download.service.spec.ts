import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AttachmentKind } from '@kurul/shared-types';
import { StorageService } from '../storage/storage.service';
import { AttachmentDownloadService } from './attachment-download.service';
import { AttachmentService } from './attachment.service';
import type { AttachmentRow } from './attachment.mapper';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const ATTACHMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const KEY = '01/98/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

function row(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    taskId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55',
    kind: AttachmentKind.File,
    filename: 'contract.pdf',
    storageKey: KEY,
    mimeType: 'application/pdf',
    size: 1234,
    url: null,
    uploadedById: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54',
    createdAt: new Date(0),
    ...overrides,
  };
}

function build(attachment: AttachmentRow = row()) {
  const attachments = {
    findRow: jest.fn().mockResolvedValue(attachment),
  } as unknown as AttachmentService;
  const storage = {
    createReadStream: jest.fn().mockResolvedValue(Readable.from(['bytes'])),
  } as unknown as StorageService;
  return { service: new AttachmentDownloadService(attachments, storage), attachments, storage };
}

describe('AttachmentDownloadService.open', () => {
  it('resolves every header before a byte exists', async () => {
    const { service } = build();

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Length': '1234',
      'Content-Disposition': `attachment; filename="contract.pdf"; filename*=UTF-8''contract.pdf`,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    });
  });

  it('serves the stored type rather than anything the caller could influence', async () => {
    // The row carries the sniffed type (K4). Validating one value and shipping another would
    // make the allowlist advisory.
    const { service } = build(row({ mimeType: 'image/png', filename: 'shot.png' }));

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['Content-Disposition']).toMatch(/^inline;/);
  });

  it.each(['text/plain', 'text/csv'])('gives %s an explicit charset', async (mimeType) => {
    // These two reach a row through the declared-label fallback rather than a magic number, and
    // a browser handed a `.csv` with no charset guesses the encoding. `plainTextType` already
    // proved the bytes decode as UTF-8, so saying so is honest rather than permissive — and
    // both are still served `attachment`, so neither renders.
    const { service } = build(row({ mimeType, filename: 'rows.csv' }));

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers['Content-Type']).toBe(`${mimeType}; charset=utf-8`);
    expect(headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it('names a stored type it has no charset opinion about without inventing one', async () => {
    const { service } = build(row({ mimeType: 'application/zip' }));

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers['Content-Type']).toBe('application/zip');
  });

  it('overrides the API-wide cross-origin resource policy for user-uploaded bytes', async () => {
    // `configure-app.ts` sets `cross-origin` globally because the web app is a separate origin.
    // That reasoning does not extend to uploaded files, which nothing off-origin should embed.
    const { service } = build();

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('404s a LINK rather than saying it is the wrong kind', async () => {
    // A LINK has no bytes. Saying "wrong kind" would confirm the row exists.
    const { service, storage } = build(
      row({ kind: AttachmentKind.Link, storageKey: null, mimeType: null, url: 'https://e.com' }),
    );

    await expect(service.open(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('404s a FILE row with no storage key rather than opening an empty path', async () => {
    const { service, storage } = build(row({ storageKey: null }));

    await expect(service.open(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('lets the tenant check fail before it asks storage for anything', async () => {
    const { service, attachments, storage } = build();
    (attachments.findRow as jest.Mock).mockRejectedValue(new NotFoundException('nope'));

    await expect(service.open(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('propagates a failed open, which happens before any header is written', async () => {
    // `DiskStorageBackend.createReadStream` stats first, so a missing key rejects before a
    // stream exists — while `AllExceptionsFilter` can still answer.
    const { service, storage } = build();
    (storage.createReadStream as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    await expect(service.open(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow('ENOENT');
  });

  it('falls back to a byte stream type when the row somehow carries none', async () => {
    const { service } = build(row({ mimeType: null }));

    const { headers } = await service.open(WORKSPACE_ID, ATTACHMENT_ID);

    expect(headers['Content-Type']).toBe('application/octet-stream');
  });
});
