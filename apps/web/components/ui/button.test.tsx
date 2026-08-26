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
    expect(button.getAttribute('data-spinner')).toBeNull();
    expect(button.textContent).toBe('Save');
  });

  it('puts nothing in the flow when loading turns true, so a label cannot shift', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Button>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;
    const idle = button.innerHTML;

    rerender(<Button loading>Save</Button>);

    // Byte-for-byte the resting content: no reserved slot, no gap, so an icon-less button keeps
    // its width and its centred label keeps its position from the first frame of the wait.
    expect(button.innerHTML).toBe(idle);
  });

  it('keeps the spinner out of flex flow once it appears', async () => {
    vi.useFakeTimers();
    const { container } = render(<Button loading>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const slot = button.querySelector("[data-slot='button-spinner']")?.parentElement;
    expect(slot?.className).toContain('absolute');
    expect(button.className).toContain('relative');
    // The label is still the label; `app/globals.css` clears it visually off `data-spinner`,
    // which is checked in app/globals-css-layers.test.ts where the compiled CSS exists.
    expect(button.getAttribute('data-spinner')).toBe('');
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
    expect(button.getAttribute('data-spinner')).toBeNull();
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
