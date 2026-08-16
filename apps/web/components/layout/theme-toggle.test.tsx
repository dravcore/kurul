import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { ThemeToggle } from './theme-toggle';

const setTheme = vi.fn();
let resolvedTheme: string | undefined;

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  resolvedTheme = 'light';
  setTheme.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThemeToggle', () => {
  it('renders nothing on the server, where the theme is not knowable yet', () => {
    // The server has no way to read the stored theme, so committing an icon there would
    // hydrate into the wrong one. Asserted through a real server render rather than by
    // poking at internals.
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ThemeToggle />
      </NextIntlClientProvider>,
    );

    expect(html).toBe('');
  });

  it('renders the control once the client has taken over', () => {
    renderToggle();

    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('offers to switch to dark while the resolved theme is light', () => {
    resolvedTheme = 'light';
    renderToggle();

    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('offers to switch to light while the resolved theme is dark', () => {
    resolvedTheme = 'dark';
    renderToggle();

    const button = screen.getByRole('button', { name: 'Switch to light theme' });
    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('labels the control from the catalog, never with a raw key', () => {
    renderToggle();

    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).not.toMatch(/^app\.shell\./);
    expect(label.length).toBeGreaterThan(0);
  });
});
