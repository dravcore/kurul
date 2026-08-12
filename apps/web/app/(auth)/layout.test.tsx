import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AuthLayout from './layout';

afterEach(() => {
  cleanup();
});

describe('AuthLayout', () => {
  it('renders the signed-out route inside a single main landmark', () => {
    render(
      <AuthLayout>
        <h1>Sign in</h1>
      </AuthLayout>,
    );

    const main = screen.getByRole('main');
    expect(main.contains(screen.getByRole('heading', { name: 'Sign in' }))).toBe(true);
  });

  it('keeps the brand mark out of the accessibility tree', () => {
    const { container } = render(
      <AuthLayout>
        <p>content</p>
      </AuthLayout>,
    );

    // Decorative only — a screen reader announcing "damga" before every auth form is noise.
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
