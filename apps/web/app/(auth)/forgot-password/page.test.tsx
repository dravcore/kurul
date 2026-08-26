import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/auth/forgot-password-view', () => ({
  ForgotPasswordView: (): React.ReactElement => <div data-testid="forgot-password-view" />,
}));

import ForgotPasswordPage from './page';

afterEach(() => {
  cleanup();
});

describe('ForgotPasswordPage', () => {
  it('renders the request form', () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByTestId('forgot-password-view')).toBeTruthy();
  });
});
