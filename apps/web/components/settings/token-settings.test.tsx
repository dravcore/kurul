import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import type { CreatedPersonalAccessTokenDto, PersonalAccessTokenDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { TokenSettings } from './token-settings';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const copy = messages.app.settings.tokens;

const workspace = vi.hoisted(() => ({ value: { activeId: '' } }));

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiDelete = vi.mocked(api.delete);

function token(
  id: string,
  name: string,
  overrides: Partial<PersonalAccessTokenDto> = {},
): PersonalAccessTokenDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    name,
    prefix: `kurul_pat_${id}`,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TokenSettings />
    </NextIntlClientProvider>,
  );
}

/** The last match, because a row control and the dialog it opens can share the same label. */
function clickLastButton(label: string): void {
  const buttons = screen.getAllByRole('button', { name: label });
  fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
}

beforeAll(() => {
  // Radix Dialog measures its content; jsdom ships neither ResizeObserver nor scrollIntoView.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  workspace.value = { activeId: WORKSPACE_ID };
  apiGet.mockReset().mockResolvedValue([]);
  apiPost.mockReset();
  apiDelete.mockReset();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TokenSettings: listing', () => {
  it("renders the caller's tokens from GET", async () => {
    apiGet.mockResolvedValue([
      token('tok-1', 'CI runner', { prefix: 'kurul_pat_Ab12Cd34' }),
      token('tok-2', 'Laptop', {
        lastUsedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
      }),
    ]);
    renderSection();

    expect(await screen.findByText('CI runner')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/tokens`, expect.anything());
    expect(screen.getByText('kurul_pat_Ab12Cd34…')).toBeTruthy();
    expect(screen.getByText(copy.lastUsedNever)).toBeTruthy();
    expect(screen.getByText(copy.expiresNever)).toBeTruthy();
    expect(screen.getByText('Laptop')).toBeTruthy();
  });

  it('shows the empty state when there are no tokens', async () => {
    apiGet.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText(copy.empty)).toBeTruthy();
  });
});

describe('TokenSettings: creating', () => {
  it('posts only the name when no expiry is chosen', async () => {
    const created: CreatedPersonalAccessTokenDto = {
      ...token('tok-new', 'New token'),
      token: 'kurul_pat_secretplaintext',
    };
    apiPost.mockResolvedValue(created as never);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.createAction }));
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: 'New token' } });
    clickLastButton(copy.createSubmit);

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/tokens`, {
      name: 'New token',
      expiresAt: undefined,
    });
  });

  /**
   * Real timers throughout: `waitFor`/`findBy*` poll on real `setTimeout`s under the hood, and
   * faking the clock stalls them along with everything else, which is why this checks the
   * result against a window around `Date.now()` rather than pinning the clock to one instant.
   */
  it('computes an ISO expiresAt for a chosen expiry option', async () => {
    const created: CreatedPersonalAccessTokenDto = {
      ...token('tok-new', 'Scoped token'),
      token: 'kurul_pat_secretplaintext',
    };
    apiPost.mockResolvedValue(created as never);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.createAction }));
    fireEvent.change(screen.getByLabelText(copy.nameLabel), {
      target: { value: 'Scoped token' },
    });
    fireEvent.change(screen.getByLabelText(copy.expiryLabel), {
      target: { value: 'days30' },
    });
    const before = Date.now();
    clickLastButton(copy.createSubmit);

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const after = Date.now();

    const [path, body] = apiPost.mock.calls[0] as unknown as [
      string,
      { name: string; expiresAt?: string },
    ];
    expect(path).toBe(`/workspaces/${WORKSPACE_ID}/tokens`);
    expect(body.name).toBe('Scoped token');
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(body.expiresAt ?? '').getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + THIRTY_DAYS_MS);
  });

  it('shows the plaintext once, then adds the row once the reveal closes', async () => {
    const created: CreatedPersonalAccessTokenDto = {
      ...token('tok-new', 'New token'),
      token: 'kurul_pat_secretplaintext',
    };
    apiPost.mockResolvedValue(created as never);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.createAction }));
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: 'New token' } });
    clickLastButton(copy.createSubmit);

    expect(await screen.findByText('kurul_pat_secretplaintext')).toBeTruthy();
    // Not yet a row in the list: the reveal dialog is still open.
    expect(screen.queryByRole('button', { name: copy.revokeAction })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy.done }));

    await waitFor(() => expect(screen.queryByText('kurul_pat_secretplaintext')).toBeNull());
    expect(await screen.findByText('New token')).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.revokeAction })).toBeTruthy();
  });

  it('copies the plaintext to the clipboard', async () => {
    const created: CreatedPersonalAccessTokenDto = {
      ...token('tok-new', 'New token'),
      token: 'kurul_pat_secretplaintext',
    };
    apiPost.mockResolvedValue(created as never);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: copy.createAction }));
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: 'New token' } });
    clickLastButton(copy.createSubmit);

    await screen.findByText('kurul_pat_secretplaintext');
    fireEvent.click(screen.getByRole('button', { name: copy.copyAction }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('kurul_pat_secretplaintext'),
    );
    expect(toast.success).toHaveBeenCalledWith(copy.copied);
  });
});

describe('TokenSettings: revoking', () => {
  it('asks first, then calls DELETE on confirm and drops the row', async () => {
    apiGet.mockResolvedValue([token('tok-1', 'CI runner')]);
    apiDelete.mockResolvedValue(undefined as never);
    renderSection();

    expect(await screen.findByText('CI runner')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: copy.revokeAction }));

    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.getByText(copy.revokeTitle)).toBeTruthy();

    clickLastButton(copy.revokeAction);

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(apiDelete).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/tokens/tok-1`);
    await waitFor(() => expect(screen.queryByText('CI runner')).toBeNull());
  });
});
