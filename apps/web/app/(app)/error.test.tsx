import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ errorState: vi.fn() }));

vi.mock('@/components/layout/route-error-state', () => ({
  RouteErrorState: (props: { homeHref?: string }): React.ReactElement => {
    mocks.errorState(props);
    return <div data-testid="error-state" />;
  },
}));

import AppError from './error';

afterEach(() => {
  cleanup();
  mocks.errorState.mockReset();
});

describe('AppError', () => {
  /**
   * Nested inside `(app)/layout.tsx`, so a broken board keeps the sidebar, the workspace
   * switcher and the notification bell — the user stays where they were instead of being
   * dropped onto a full-screen replacement of the whole app.
   */
  it('renders inside the shell and offers the dashboard as the way out', () => {
    const error = new Error('board render failed');
    const reset = vi.fn();

    render(<AppError error={error} reset={reset} />);

    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(mocks.errorState).toHaveBeenCalledWith(
      expect.objectContaining({ error, reset, homeHref: '/dashboard' }),
    );
  });
});
