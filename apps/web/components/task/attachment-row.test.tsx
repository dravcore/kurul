import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type AttachmentDto, AttachmentKind } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { AttachmentRow } from './attachment-row';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, getBlob: vi.fn() } };
});

const getBlob = vi.mocked(api.getBlob);

const PDF: AttachmentDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01',
  taskId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
  kind: AttachmentKind.File,
  filename: 'contract.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  url: null,
  uploadedById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PNG: AttachmentDto = {
  ...PDF,
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e02',
  filename: 'shot.png',
  mimeType: 'image/png',
};

const LINK: AttachmentDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e03',
  taskId: PDF.taskId,
  kind: AttachmentKind.Link,
  filename: 'Design file',
  mimeType: null,
  size: null,
  url: 'https://figma.example/file/1',
  uploadedById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderRow(attachment: AttachmentDto, onRemove?: (id: string) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AttachmentRow workspaceId={WORKSPACE_ID} attachment={attachment} onRemove={onRemove} />
    </NextIntlClientProvider>,
  );
}

/**
 * jsdom ships no object-URL implementation, so both halves are supplied here. They are assigned
 * rather than spied because there is nothing on `URL` to spy on, and the fake mints a distinct
 * string per call so the revoke assertion below cannot pass by matching a constant.
 */
let mintedUrls = 0;
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mintedUrls = 0;
  URL.createObjectURL = vi.fn(() => `blob:kurul/${(mintedUrls += 1)}`);
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  cleanup();
});

describe('AttachmentRow', () => {
  it('downloads a FILE from the API content endpoint', () => {
    renderRow(PDF);

    const anchor = screen.getByRole('link', { name: 'Download contract.pdf' });
    expect(anchor.getAttribute('href')).toContain(
      `/workspaces/${WORKSPACE_ID}/attachments/${PDF.id}/content`,
    );
    expect(anchor.getAttribute('download')).toBe('contract.pdf');
  });

  it('opens a LINK in a new tab with noopener and noreferrer', () => {
    // ADR 0024 K7's client half. `noopener` keeps the opened page from reaching back through
    // `window.opener`; `noreferrer` keeps the board URL out of its `Referer`. Neither is
    // decoration, and the server has never fetched this URL to learn anything safer about it.
    renderRow(LINK);

    const anchor = screen.getByRole('link', { name: 'Open Design file in a new tab' });
    expect(anchor.getAttribute('href')).toBe('https://figma.example/file/1');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never asks for the bytes of a LINK or of a non-image file', async () => {
    renderRow(LINK);
    renderRow(PDF);

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('previews an image from a blob it fetched, not from a direct src on the API origin', async () => {
    // Split-domain deployments have the API on another origin, and the web CSP's `img-src`
    // names no host — a direct `<img src>` at the content endpoint is refused there.
    getBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));

    renderRow(PNG);

    const image = await screen.findByAltText('shot.png');
    expect(getBlob).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/attachments/${PNG.id}/content`,
    );
    expect(image.getAttribute('src')).toMatch(/^blob:/);
  });

  it('releases the object URL when the row goes away', async () => {
    // An object URL is a reference held by the document, not by the variable. Without the
    // revoke, every task the reader opens pins the full bytes of its images for the lifetime
    // of the tab.
    getBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));

    const view = renderRow(PNG);
    const src = (await screen.findByAltText('shot.png')).getAttribute('src');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith(src);
  });

  it('drops the preview rather than the row when the bytes cannot be read', async () => {
    getBlob.mockRejectedValue(new Error('gone'));

    renderRow(PNG);

    await waitFor(() => expect(getBlob).toHaveBeenCalled());
    expect(screen.queryByAltText('shot.png')).toBeNull();
    expect(screen.getByRole('link', { name: 'Download shot.png' })).toBeDefined();
  });

  it('offers no delete control without a handler, and names the file when it has one', () => {
    const { unmount } = renderRow(PDF);
    expect(screen.queryByRole('button', { name: /Delete attachment/ })).toBeNull();
    unmount();

    const onRemove = vi.fn();
    renderRow(PDF, onRemove);
    fireEvent.click(screen.getByRole('button', { name: 'Delete attachment contract.pdf' }));

    expect(onRemove).toHaveBeenCalledWith(PDF.id);
  });
});
