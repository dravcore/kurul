import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { ColumnCategory, type ColumnDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { ColumnSettingsDialog } from './column-settings-dialog';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { patch: vi.fn() } };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiPatch = vi.mocked(api.patch);
const toastSuccess = vi.mocked(toast.success);

const column: ColumnDto = {
  id: COLUMN_ID,
  boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02',
  name: 'Shipped',
  position: 3000,
  color: null,
  category: ColumnCategory.UNSTARTED,
  taskCount: 0,
};

function renderDialog(subject: ColumnDto = column) {
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ColumnSettingsDialog
        open
        onOpenChange={vi.fn()}
        workspaceId={WORKSPACE_ID}
        column={subject}
        onSaved={onSaved}
      />
    </NextIntlClientProvider>,
  );
  return { onSaved };
}

const categorySelect = (): HTMLSelectElement => screen.getByLabelText('Category');
const nameField = (): HTMLInputElement => screen.getByLabelText('Name');
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;

beforeAll(() => {
  // Radix Dialog measures and focus-traps its content; jsdom ships neither.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  apiPatch.mockReset();
  apiPatch.mockImplementation((_path, body) =>
    Promise.resolve({ ...column, ...(body as object) } as never),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ColumnSettingsDialog', () => {
  it('offers every category the enum defines', () => {
    renderDialog();

    const values = [...categorySelect().querySelectorAll('option')].map((option) => option.value);
    // Workflow order, not enum-declaration order — and asserted so that a value added to
    // the enum has to be placed here deliberately rather than going unoffered.
    expect(values).toEqual(['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED']);
  });

  it('shows the column its current category, not a default', () => {
    renderDialog({ ...column, category: ColumnCategory.STARTED });

    expect(categorySelect().value).toBe('STARTED');
  });

  it('marks a renamed column completed without touching its name', async () => {
    // The half of the ADR 0019 defect the schema alone cannot fix: a user's own "Shipped"
    // column never counts as done unless they can say so here.
    const { onSaved } = renderDialog();

    fireEvent.change(categorySelect(), { target: { value: 'COMPLETED' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/columns/${COLUMN_ID}`, {
      name: 'Shipped',
      category: 'COMPLETED',
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ category: 'COMPLETED' }));
  });

  it('confirms the save, because a category change leaves no mark on the board', async () => {
    // The board renders a column's name, never its category. Without this the dialog closes
    // over a board that looks exactly as it did, and the user has no way to tell the save
    // landed — the one write here that the screen cannot report on its own.
    renderDialog();

    fireEvent.change(categorySelect(), { target: { value: 'COMPLETED' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(messages.app.board.column.settingsSaved);
  });

  it('renames without changing the category', async () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: 'Released' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(expect.any(String), {
      name: 'Released',
      category: 'UNSTARTED',
    });
  });

  it('explains what the category is for rather than leaving the user to guess', () => {
    renderDialog();

    // A category nobody understands gets left wrong, and a wrong category fails silently —
    // so the hint is wired to the control, not just placed near it.
    const hintId = categorySelect().getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId as string)?.textContent).toContain('Reports use the');
  });

  it('refuses to save an empty name', () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: '   ' } });

    expect(saveButton().disabled).toBe(true);
  });

  it('routes every string through the message catalog', () => {
    renderDialog();

    // A hardcoded string is invisible to the Turkish pass (ADR 0018), and next-intl renders
    // a missing key as the key itself — so no rendered text may look like one.
    for (const node of document.querySelectorAll('label, option, button, h2, p')) {
      expect(node.textContent ?? '').not.toMatch(/^app\.board\.column\./);
    }
    expect(screen.getByRole('heading', { name: 'Column settings' })).toBeTruthy();
  });
});
