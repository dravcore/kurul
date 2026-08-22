import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('marks the main region as the skip-link target', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AppShell>
          <p>Route content</p>
        </AppShell>
      </NextIntlClientProvider>,
    );

    // The (app) layout's skip link points at #main-content; tabIndex -1 lets that
    // fragment navigation move keyboard focus into the region (WCAG 2.4.1).
    const main = screen.getByRole('main');
    expect(main.id).toBe('main-content');
    expect(main.tabIndex).toBe(-1);
    expect(main.textContent).toBe('Route content');
  });
});
