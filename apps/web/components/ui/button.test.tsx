import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Button } from './button';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The spinner (14px, its own `spinner` keyframe bound through `[data-slot='button-spinner']`)
 * is written as real CSS in `app/globals.css`, not as a class here: `app/globals-css-layers.test.ts`
 * checks the keyframe and its reduced-motion twin. This suite only checks the two things a
 * jsdom render can see: the 400ms threshold the timeout applies to when the marker mounts, and
 * the button's own attributes.
 */
describe('Button loading', () => {
  it('is aria-busy and disabled immediately, with no spinner before 400ms', async () => {
    vi.useFakeTimers();
    const { container } = render(<Button loading>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(button.querySelector("[data-slot='button-spinner']")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });

    expect(button.querySelector("[data-slot='button-spinner']")).toBeNull();
    // The label never moves while the icon slot fills in underneath it.
    expect(button.textContent).toBe('Save');
  });

  it('shows the spinner once the 400ms threshold passes', async () => {
    vi.useFakeTimers();
    const { container } = render(<Button loading>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(button.querySelector("[data-slot='button-spinner']")).not.toBeNull();
    expect(button.textContent).toBe('Save');
  });

  it('is not aria-busy or disabled, and never spins up, when loading is false', () => {
    const { container } = render(<Button>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.disabled).toBe(false);
  });

  it('clears the pending timer when loading flips back to false before 400ms', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Button loading>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    rerender(<Button loading={false}>Save</Button>);

    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.disabled).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(button.querySelector("[data-slot='button-spinner']")).toBeNull();
  });

  it('clears the pending timer on unmount rather than setting state on an unmounted component', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<Button loading>Save</Button>);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('keeps disabled combined with the caller’s own disabled prop when not loading', () => {
    const { container } = render(<Button disabled>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it('ignores loading on asChild, since the rendered element is the caller’s own', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <Button asChild loading>
        <a href="/board">Go</a>
      </Button>,
    );
    const anchor = container.querySelector('a') as HTMLAnchorElement;

    expect(anchor.getAttribute('aria-busy')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(container.querySelector("[data-slot='button-spinner']")).toBeNull();
  });
});
