import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { WorkspaceDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { RenameWorkspaceDialog } from './rename-workspace-dialog';

const copy = messages.app.settings.workspace;

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { patch: vi.fn() } };
});

const apiPatch = vi.mocked(api.patch);

const workspace: WorkspaceDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00',
  name: 'Kurultay',
  slug: 'kurultay',
  createdAt: '2026-01-01T00:00:00.000Z',
};

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
    Promise.resolve({ ...workspace, ...(body as object) } as never),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog() {
  const onRenamed = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RenameWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        workspace={workspace}
        onRenamed={onRenamed}
      />
    </NextIntlClientProvider>,
  );
  return { onRenamed };
}

const nameField = (): HTMLInputElement => screen.getByLabelText(copy.name) as HTMLInputElement;
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: copy.renameAction }) as HTMLButtonElement;

describe('RenameWorkspaceDialog', () => {
  it('opens with the workspace’s current name', () => {
    renderDialog();

    expect(nameField().value).toBe('Kurultay');
  });

  it('sends the trimmed name to the workspace endpoint and reports the update back', async () => {
    const { onRenamed } = renderDialog();

    fireEvent.change(nameField(), { target: { value: '  Kurultay Labs  ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${workspace.id}`, {
      name: 'Kurultay Labs',
    });
    expect(onRenamed).toHaveBeenCalledWith(
      expect.objectContaining({ id: workspace.id, name: 'Kurultay Labs' }),
    );
  });

  it('refuses to save an empty name', () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: '   ' } });

    expect(saveButton().disabled).toBe(true);
  });

  it('never sends a slug — nothing in the app resolves a route by it', async () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: 'New name' } });
    fireEvent.click(saveButton());

    // An exact-match assertion, not just presence: `toHaveBeenCalledWith` fails on an extra
    // `slug` key just as readily as on a missing `name`, so this is the same check as asserting
    // `slug` is absent, without reaching into `.mock.calls` by hand.
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${workspace.id}`, { name: 'New name' }),
    );
  });
});
