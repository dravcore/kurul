import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn<(path: string, body: unknown) => Promise<unknown>>(),
  setActive: vi.fn(),
  onSignOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/api', () => ({ api: { post: mocks.post } }));

vi.mock('@/lib/auth', () => ({
  authClient: { organization: { setActive: mocks.setActive } },
}));

// Same call site `SidebarBody`'s sign-out button uses (`components/layout/sidebar-body.tsx`):
// the actual sign-out sequence lives once in `WorkspaceProvider`, so this route reuses it
// through the context rather than a second copy.
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ onSignOut: mocks.onSignOut }),
}));

import NewWorkspacePage from './page';

function renderPage(): ReturnType<typeof render> {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NewWorkspacePage />
    </NextIntlClientProvider>,
  );
}

const nameField = (): HTMLInputElement => screen.getByLabelText('Name');
const slugField = (): HTMLInputElement => screen.getByLabelText('Slug');

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.post.mockReset().mockResolvedValue({ id: WORKSPACE_ID });
  mocks.setActive.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.onSignOut.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('NewWorkspacePage scroller', () => {
  it('declares its own flex-1 overflow-y-auto scroller, since the shell main has none', () => {
    const { container } = renderPage();

    const scroller = container.querySelector('.overflow-y-auto');

    expect(scroller).not.toBeNull();
    expect(scroller?.className).toContain('flex-1');
  });
});

describe('NewWorkspacePage header', () => {
  it('shows the wordmark and signs out through the shared workspace mechanism', () => {
    renderPage();

    expect(screen.getByText('Kurul')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mocks.onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('NewWorkspacePage', () => {
  it('derives a URL-safe slug from the name as it is typed', () => {
    renderPage();

    fireEvent.change(nameField(), { target: { value: '  Steppe Collective!!  ' } });

    expect(slugField().value).toBe('steppe-collective');
  });

  it('stops deriving the slug once it has been edited by hand', () => {
    renderPage();

    fireEvent.change(nameField(), { target: { value: 'Steppe Collective' } });
    fireEvent.change(slugField(), { target: { value: 'kurul' } });
    fireEvent.change(nameField(), { target: { value: 'Steppe Collective Renamed' } });

    expect(slugField().value).toBe('kurul');
  });

  it('activates the created workspace before leaving for the dashboard', async () => {
    renderPage();
    fireEvent.change(nameField(), { target: { value: 'Steppe Collective' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/workspaces', {
        name: 'Steppe Collective',
        slug: 'steppe-collective',
      }),
    );
    // Landing on the dashboard before the active organization is set shows the old workspace.
    await waitFor(() =>
      expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: WORKSPACE_ID }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('keeps the form filled in when creation fails', async () => {
    mocks.post.mockRejectedValue(new Error('409'));
    renderPage();
    fireEvent.change(nameField(), { target: { value: 'Steppe Collective' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Could not create workspace.')).toBeTruthy();
    expect(nameField().value).toBe('Steppe Collective');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
