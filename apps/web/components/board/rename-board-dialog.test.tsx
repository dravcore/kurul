import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { BoardDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { RenameBoardDialog } from './rename-board-dialog';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { patch: vi.fn() } };
});

const apiPatch = vi.mocked(api.patch);

const board: BoardDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
  workspaceId: WORKSPACE_ID,
  name: 'Roadmap',
  description: 'Where the quarter lives',
} as BoardDto;

const other: BoardDto = {
  ...board,
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d11',
  name: 'Bugs',
  description: null,
} as BoardDto;

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
    Promise.resolve({ ...board, ...(body as object) } as never),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(subject: BoardDto | null = board) {
  const onRenamed = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RenameBoardDialog
        open={subject !== null}
        onOpenChange={vi.fn()}
        workspaceId={WORKSPACE_ID}
        board={subject}
        onRenamed={onRenamed}
      />
    </NextIntlClientProvider>,
  );

  const rerender = (next: BoardDto | null): void => {
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RenameBoardDialog
          open={next !== null}
          onOpenChange={vi.fn()}
          workspaceId={WORKSPACE_ID}
          board={next}
          onRenamed={onRenamed}
        />
      </NextIntlClientProvider>,
    );
  };

  return { onRenamed, rerender };
}

const nameField = (): HTMLInputElement => screen.getByLabelText('Name') as HTMLInputElement;
const descriptionField = (): HTMLInputElement =>
  screen.getByLabelText('Description') as HTMLInputElement;
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement;

describe('RenameBoardDialog', () => {
  it('opens with the board’s current name and description', () => {
    renderDialog();

    expect(nameField().value).toBe('Roadmap');
    expect(descriptionField().value).toBe('Where the quarter lives');
  });

  it('shows an empty description when the board has none', () => {
    renderDialog(other);

    expect(descriptionField().value).toBe('');
  });

  it('loads the fields of whichever board is opened next', () => {
    // The dialog stays mounted across openings, so a second board must not inherit the
    // first one's values.
    const { rerender } = renderDialog();

    rerender(null);
    rerender(other);

    expect(nameField().value).toBe('Bugs');
    expect(descriptionField().value).toBe('');
  });

  it('keeps what the user typed while the same board stays open', () => {
    const { rerender } = renderDialog();

    fireEvent.change(nameField(), { target: { value: 'Half-typed' } });
    // A re-render for an unrelated reason must not stomp the edit in progress.
    rerender(board);

    expect(nameField().value).toBe('Half-typed');
  });

  it('sends the trimmed name and description', async () => {
    const { onRenamed } = renderDialog();

    fireEvent.change(nameField(), { target: { value: '  Q3 roadmap  ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards/${board.id}`, {
      name: 'Q3 roadmap',
      description: 'Where the quarter lives',
    });
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Q3 roadmap' }));
  });

  it('sends null rather than an empty description', async () => {
    renderDialog();

    fireEvent.change(descriptionField(), { target: { value: '   ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(expect.any(String), {
      name: 'Roadmap',
      description: null,
    });
  });

  it('refuses to save an empty name', () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: '   ' } });

    expect(saveButton().disabled).toBe(true);
  });
});
