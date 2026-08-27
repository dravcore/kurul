import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

vi.mock('./app-sidebar', () => ({
  AppSidebar: (): React.ReactElement => <div data-testid="app-sidebar" />,
}));

// Stubbed rather than left to run: the real one fetches `GET /config` on mount, which this
// suite has no server for. Its own behaviour is covered in `demo-banner.test.tsx`.
vi.mock('./demo-banner', () => ({
  DemoBanner: (): null => null,
}));

const context = vi.hoisted(() => ({
  value: {
    workspaces: [{ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70' }] as Array<{ id: string }>,
    sessionPending: false,
    hasSession: true,
    bootstrapped: true,
    loadError: null as string | null,
    retryBootstrap: (): void => {},
  },
}));

vi.mock('./workspace-provider', () => ({
  WorkspaceProvider: ({ children }: Readonly<{ children: React.ReactNode }>) => children,
  useWorkspaceContext: () => context.value,
}));

import { AppShell } from './app-shell';

function renderShell(): RenderResult {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AppShell>
        <p>Route content</p>
      </AppShell>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  context.value.workspaces = [{ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70' }];
  context.value.bootstrapped = true;
});

describe('AppShell', () => {
  it('marks the main region as the skip-link target', () => {
    renderShell();

    // The (app) layout's skip link points at #main-content; tabIndex -1 lets that
    // fragment navigation move keyboard focus into the region (WCAG 2.4.1).
    const main = screen.getByRole('main');
    expect(main.id).toBe('main-content');
    expect(main.tabIndex).toBe(-1);
    expect(main.textContent).toBe('Route content');
  });

  /**
   * The skip link is a keyboard action, so its landing has to be visible: `app/globals.css`
   * draws the one focus mark in `@layer base`, and a utility on this element is the only thing
   * that can outrank it. The offset is pulled inside because the region fills the shell and the
   * row around it is `overflow-hidden`, which clips an outline drawn outside the region;
   * app/globals-css-layers.test.ts checks that utility against the compiled cascade.
   */
  it('leaves the skip-link landing a visible focus mark, pulled inside the region', () => {
    renderShell();

    const main = screen.getByRole('main');
    expect(main.className).not.toMatch(/\boutline-(none|hidden)\b/);
    expect(main.className.split(/\s+/)).toContain('focus-visible:-outline-offset-2');
  });

  it('shows the sidebar once there is a workspace to navigate', () => {
    renderShell();

    expect(screen.getByTestId('app-sidebar')).toBeDefined();
  });

  /**
   * A reader with no workspace is on `/workspaces/new`, and `workspace-provider.tsx` puts them
   * back there from anywhere else. Every `SidebarBody` link needs a workspace, so the whole
   * navigation would be that redirect under a different name, and the route's own header would
   * be a second wordmark and a second sign-out next to the sidebar's from 768px up.
   */
  it('drops the sidebar entirely while the roster is empty', () => {
    context.value.workspaces = [];

    renderShell();

    expect(screen.queryByTestId('app-sidebar')).toBeNull();
    expect(screen.getByRole('main').textContent).toBe('Route content');
  });
});

/**
 * Before any bootstrap has ever finished, `workspaces` is the same empty array a confirmed-
 * zero account would have, and the two can't be told apart by the array alone. The shape has to
 * default to painting in that case: hiding it here is what used to make a returning reader's
 * plain reload skip the sidebar shape and then pop one in once the roster resolved.
 */
describe('AppShell loading skeleton', () => {
  it('paints the sidebar shape on a fresh mount, before any roster is known', () => {
    context.value.bootstrapped = false;
    context.value.workspaces = [];

    const { container } = renderShell();

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7);
  });

  it('keeps the sidebar shape once a roster is already on hand', () => {
    context.value.bootstrapped = false;
    context.value.workspaces = [{ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70' }];

    const { container } = renderShell();

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7);
  });

  /**
   * The one case where an empty `workspaces` really does mean "confirmed none": a completed
   * bootstrap has already resolved the roster empty, and a second load (a manual retry) is now
   * in flight. `useApiResource` leaves the resolved value standing while a fresh load runs, so
   * this is the scenario that lets the shell tell "not yet known" apart from "confirmed empty"
   * at all: it has to have seen `bootstrapped` true at least once first.
   */
  it('skips the sidebar shape once a completed bootstrap has confirmed the roster is empty', () => {
    context.value.bootstrapped = true;
    context.value.workspaces = [];

    const { container, rerender } = renderShell();

    context.value.bootstrapped = false;
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AppShell>
          <p>Route content</p>
        </AppShell>
      </NextIntlClientProvider>,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });
});
