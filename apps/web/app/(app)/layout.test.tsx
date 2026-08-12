import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

import AppLayout from './layout';

afterEach(() => {
  cleanup();
});

describe('AppLayout', () => {
  it('wraps every signed-in route in the app shell', () => {
    render(
      <AppLayout>
        <p>Route content</p>
      </AppLayout>,
    );

    expect(screen.getByTestId('app-shell').textContent).toBe('Route content');
  });
});
