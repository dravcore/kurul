import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ToasterProps } from 'sonner';
import { Toaster } from './sonner';

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));

// The real Toaster renders a portal whose props leave no trace in the DOM, so the wrapper's
// contract is read off the props it hands the library instead.
const sonnerToaster = vi.fn((_props: ToasterProps) => <div data-testid="sonner" />);
vi.mock('sonner', () => ({ Toaster: (props: ToasterProps) => sonnerToaster(props) }));

afterEach(() => {
  cleanup();
  sonnerToaster.mockClear();
});

function lastProps(): ToasterProps {
  const call = sonnerToaster.mock.calls.at(-1);
  if (!call) throw new Error('the Toaster was not rendered');
  return call[0];
}

describe('Toaster', () => {
  it('dismisses a toast after four seconds', () => {
    render(<Toaster />);

    expect(lastProps().duration).toBe(4000);
  });

  it('shows at most three toasts at once', () => {
    render(<Toaster />);

    expect(lastProps().visibleToasts).toBe(3);
  });

  it('lets a caller override both', () => {
    render(<Toaster duration={9000} visibleToasts={1} />);

    expect(lastProps().duration).toBe(9000);
    expect(lastProps().visibleToasts).toBe(1);
  });

  it('follows the resolved theme', () => {
    render(<Toaster />);

    expect(lastProps().theme).toBe('dark');
  });
});
