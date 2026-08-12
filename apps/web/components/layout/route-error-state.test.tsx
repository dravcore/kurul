import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { RouteErrorState } from './route-error-state';

function boom(): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    'TypeError: cannot read properties of undefined (reading "columns")',
  );
  error.digest = '3462901716';
  return error;
}

function renderState(overrides: Partial<Parameters<typeof RouteErrorState>[0]> = {}) {
  const reset = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteErrorState error={boom()} reset={reset} {...overrides} />
    </NextIntlClientProvider>,
  );
  return { reset };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RouteErrorState', () => {
  it('names the problem in the catalogue voice, not the runtime one', () => {
    renderState();

    expect(screen.getByRole('heading', { name: messages.app.errors.pageTitle })).toBeDefined();
    expect(screen.getByText(messages.app.errors.pageBody)).toBeDefined();
  });

  /**
   * `docs/design.md` §6: never print an id, a stack trace, or the word "Oops". The digest is
   * the only thread back to a server log, so it is logged rather than shown.
   */
  it('keeps the thrown detail off the screen and in the console', () => {
    renderState();

    expect(screen.queryByText(/cannot read properties/i)).toBeNull();
    expect(screen.queryByText(/3462901716/)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('offers the retry as a real control', () => {
    const { reset } = renderState();

    fireEvent.click(screen.getByRole('button', { name: messages.app.errors.retry }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers a way out only where there is somewhere to go', () => {
    renderState();
    expect(screen.queryByRole('link', { name: messages.app.errors.backHome })).toBeNull();

    cleanup();
    renderState({ homeHref: '/dashboard' });

    expect(
      screen.getByRole('link', { name: messages.app.errors.backHome }).getAttribute('href'),
    ).toBe('/dashboard');
  });
});
