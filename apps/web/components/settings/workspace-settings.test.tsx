import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type WorkspaceDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { WorkspaceSettings } from './workspace-settings';

const copy = messages.app.settings.workspace;

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const workspace: WorkspaceDto = {
  id: WORKSPACE_ID,
  name: 'Kurul',
  slug: 'kurul',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * `renameActiveWorkspace` folds a rename back into `workspaces` the exact same way the real
 * `WorkspaceProvider` does — so the fixture doubles as a check that `WorkspaceSettings` reads
 * the row it renders from that array rather than caching its own copy of the name.
 */
const context = vi.hoisted(() => ({
  value: {
    workspaces: [] as WorkspaceDto[],
    activeId: '',
    activeRole: null as MemberRole | null,
    bootstrapped: true,
    renameActiveWorkspace: (updated: WorkspaceDto): void => {
      context.value = {
        ...context.value,
        workspaces: context.value.workspaces.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      };
    },
  },
}));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => context.value,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({
  authClient: { organization: { setActive: vi.fn().mockResolvedValue(undefined) } },
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { patch: vi.fn(), delete: vi.fn() } };
});

const apiPatch = vi.mocked(api.patch);
const apiDelete = vi.mocked(api.delete);

beforeAll(() => {
  // Radix Dialog measures its content; jsdom ships none of the APIs it probes for.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  context.value = {
    ...context.value,
    workspaces: [workspace],
    activeId: WORKSPACE_ID,
    activeRole: MemberRole.OWNER,
    bootstrapped: true,
  };
  apiPatch.mockReset();
  apiDelete.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkspaceSettings />
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceSettings — what an OWNER sees', () => {
  it('draws both the rename and the delete-workspace controls', () => {
    renderSection();

    expect(screen.getByRole('button', { name: copy.renameAction })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.deleteAction })).toBeTruthy();
  });

  it('renaming through the dialog updates the name shown on the row', async () => {
    apiPatch.mockResolvedValue({ ...workspace, name: 'Kurul Labs' } as never);
    renderSection();

    expect(screen.getByText('Kurul')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: copy.renameAction }));
    const nameField = screen.getByLabelText(copy.name) as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: 'Kurul Labs' } });
    // Two buttons now share the "Rename" label — the row's opener and the dialog's submit —
    // so the submit is the last one in document order.
    const submitButtons = screen.getAllByRole('button', { name: copy.renameAction });
    fireEvent.click(submitButtons[submitButtons.length - 1] as HTMLElement);

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}`, {
      name: 'Kurul Labs',
    });
    await waitFor(() => expect(screen.getByText('Kurul Labs')).toBeTruthy());
    expect(screen.queryByText('Kurul')).toBeNull();
  });
});

describe('WorkspaceSettings — what an ADMIN sees', () => {
  it('draws the rename control but not delete', () => {
    context.value = { ...context.value, activeRole: MemberRole.ADMIN };
    renderSection();

    expect(screen.getByRole('button', { name: copy.renameAction })).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.deleteAction })).toBeNull();
  });
});

describe('WorkspaceSettings — what a MEMBER sees', () => {
  it('draws neither control — the API would answer 403 to both', () => {
    context.value = { ...context.value, activeRole: MemberRole.MEMBER };
    renderSection();

    expect(screen.getByText('Kurul')).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.renameAction })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.deleteAction })).toBeNull();
  });

  it('never mounts the delete dialog at all, not just hides its trigger', () => {
    context.value = { ...context.value, activeRole: MemberRole.MEMBER };
    renderSection();

    expect(screen.queryByText(copy.deleteTitle)).toBeNull();
  });
});
