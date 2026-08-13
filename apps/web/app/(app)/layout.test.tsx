import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  getTranslations: vi.fn<(ns: string) => Promise<(key: string) => string>>(),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

import AppLayout from './layout';

beforeEach(() => {
  // Resolve keys against the real English catalogue so the assertions read like the UI.
  mocks.getTranslations.mockReset().mockResolvedValue((key: string) => {
    const value = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages.app);
    return String(value);
  });
});

afterEach(() => {
  cleanup();
});

describe('AppLayout', () => {
  it('wraps every signed-in route in the app shell', async () => {
    render(await AppLayout({ children: <p>Route content</p> }));

    expect(screen.getByTestId('app-shell').textContent).toBe('Route content');
  });

  it('puts a skip link to the main content ahead of the shell (WCAG 2.4.1)', async () => {
    const { container } = render(await AppLayout({ children: <p>Route content</p> }));

    const skipLink = screen.getByRole('link', { name: messages.app.shell.skipToContent });
    expect(skipLink.getAttribute('href')).toBe('#main-content');
    // First element in the layout, so it is the first tab stop on every page.
    expect(container.firstElementChild).toBe(skipLink);
  });
});
