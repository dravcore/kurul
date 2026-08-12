import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ errorState: vi.fn() }));

vi.mock('@/components/layout/route-error-state', () => ({
  RouteErrorState: (props: { homeHref?: string }): React.ReactElement => {
    mocks.errorState(props);
    return <div data-testid="error-state" />;
  },
}));

import RootError from './error';

afterEach(() => {
  cleanup();
  mocks.errorState.mockReset();
});

describe('RootError', () => {
  /**
   * The last boundary before Next's own bare error screen. It sits outside every route group,
   * so it also catches the signed-out routes — where "back to your boards" is not a way out.
   */
  it('hands the boundary arguments to the shared error state, with nowhere to send the user', () => {
    const error = new Error('render failed');
    const reset = vi.fn();

    render(<RootError error={error} reset={reset} />);

    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(mocks.errorState).toHaveBeenCalledWith(expect.objectContaining({ error, reset }));
    expect(mocks.errorState.mock.calls[0]?.[0].homeHref).toBeUndefined();
  });
});
