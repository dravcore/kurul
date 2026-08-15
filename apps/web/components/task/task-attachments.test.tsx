import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type AttachmentDto, AttachmentKind } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskAttachments } from './task-attachments';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, getBlob: vi.fn() } };
});

const FILE: AttachmentDto = {
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

const LINK: AttachmentDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e03',
  taskId: FILE.taskId,
  kind: AttachmentKind.Link,
  filename: 'Design file',
  mimeType: null,
  size: null,
  url: 'https://figma.example/file/1',
  uploadedById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

type Overrides = {
  attachments?: AttachmentDto[];
  canMutate?: boolean;
  storageEnabled?: boolean;
  pending?: boolean;
  loading?: boolean;
  loadFailed?: boolean;
};

function renderSection(overrides: Overrides = {}) {
  const onUpload = vi.fn().mockResolvedValue(true);
  const onAddLink = vi.fn().mockResolvedValue(true);
  const onRemove = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskAttachments
        workspaceId={WORKSPACE_ID}
        attachments={overrides.attachments ?? []}
        canMutate={overrides.canMutate ?? true}
        storageEnabled={overrides.storageEnabled ?? true}
        pending={overrides.pending ?? false}
        loading={overrides.loading ?? false}
        loadFailed={overrides.loadFailed ?? false}
        onUpload={onUpload}
        onAddLink={onAddLink}
        onRemove={onRemove}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, onUpload, onAddLink, onRemove };
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:kurultay/1');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('TaskAttachments', () => {
  it('shows a download link for a file and an external link for a LINK', () => {
    renderSection({ attachments: [FILE, LINK] });

    expect(
      screen.getByRole('link', { name: 'Download contract.pdf' }).getAttribute('href'),
    ).toContain(`/attachments/${FILE.id}/content`);

    const external = screen.getByRole('link', { name: 'Open Design file in a new tab' });
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('hides the file control when the instance stores nothing but keeps the link control', () => {
    // Storage off is not the feature off: a LINK stores a string, not bytes, so it keeps
    // working — and rows that already exist stay listed and deletable either way.
    renderSection({ attachments: [], storageEnabled: false });

    expect(screen.queryByLabelText('Attach a file')).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach a link' })).toBeDefined();
    expect(screen.getByText(/does not store files/)).toBeDefined();
  });

  it('keeps existing rows deletable when the instance stores nothing', () => {
    const { onRemove } = renderSection({ attachments: [FILE], storageEnabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'Delete attachment contract.pdf' }));

    expect(onRemove).toHaveBeenCalledWith(FILE.id);
  });

  it('does not offer any control at all to a viewer', () => {
    renderSection({ attachments: [FILE], canMutate: false });

    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull();
    expect(screen.queryByLabelText('Attach a file')).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete attachment/ })).toBeNull();
  });

  it('renders nothing at all for a viewer looking at a task with no attachments', () => {
    const { container } = renderSection({ attachments: [], canMutate: false });

    expect(container.innerHTML).toBe('');
  });

  it('tells the three empty-ish states apart', () => {
    const loadingView = renderSection({ loading: true });
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.queryByText('Nothing attached yet')).toBeNull();
    loadingView.unmount();

    const failedView = renderSection({ loadFailed: true });
    expect(screen.getByText("The attachments couldn't load.")).toBeDefined();
    expect(screen.queryByText('Nothing attached yet')).toBeNull();
    failedView.unmount();

    renderSection({});
    expect(screen.getByText('Nothing attached yet')).toBeDefined();
  });

  it('hands the picked file up and clears the input so the same file can be picked again', async () => {
    const { onUpload } = renderSection({});

    const input = screen.getByLabelText('Attach a file') as HTMLInputElement;
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });

    // jsdom never gives a file input a non-empty `value`, so asserting it is `''` after the
    // change proves nothing on its own — the clear this test is about is invisible. A real
    // browser puts the picked path there, so it is put there by hand and the handler's own
    // assignment is what has to take it away again.
    let value = 'C:\\fakepath\\note.txt';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    // Without this, picking the same file twice fires no `change` at all and a failed upload
    // cannot be retried from the same file.
    expect(input.value).toBe('');
  });
});
