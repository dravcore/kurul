import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useCreateTaskShortcut } from './use-create-task-shortcut';

/** Dispatches a keydown from `target`, which is what the guards read. */
function press(
  target: EventTarget,
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function mount(node: HTMLElement): HTMLElement {
  document.body.append(node);
  return node;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('useCreateTaskShortcut', () => {
  it('opens the composer on a bare c', () => {
    const onTrigger = vi.fn();
    renderHook(() => useCreateTaskShortcut(onTrigger));

    expect(press(document.body, 'c')).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['shift', { shiftKey: true }, 'C'],
    ['meta', { metaKey: true }, 'c'],
    ['ctrl', { ctrlKey: true }, 'c'],
    ['alt', { altKey: true }, 'c'],
  ])('leaves %s + c to the browser', (_name, modifiers, key) => {
    const onTrigger = vi.fn();
    renderHook(() => useCreateTaskShortcut(onTrigger));

    expect(press(document.body, key, modifiers)).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it.each([
    ['an input', () => document.createElement('input')],
    ['a textarea', () => document.createElement('textarea')],
    [
      'a contenteditable',
      () => {
        const node = document.createElement('div');
        // jsdom implements neither `contentEditable` nor the `isContentEditable` it derives, so
        // the flag the guard reads is defined here rather than switched on.
        Object.defineProperty(node, 'isContentEditable', { value: true });
        return node;
      },
    ],
  ])('types a letter into %s instead', (_name, make) => {
    const onTrigger = vi.fn();
    renderHook(() => useCreateTaskShortcut(onTrigger));

    expect(press(mount(make()), 'c')).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('stays out of an open dialog', () => {
    const onTrigger = vi.fn();
    renderHook(() => useCreateTaskShortcut(onTrigger));
    const dialog = mount(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dialog.append(inside);

    expect(press(inside, 'c')).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('does nothing for a board with nothing to add a task to', () => {
    renderHook(() => useCreateTaskShortcut(null));

    expect(press(document.body, 'c')).toBe(false);
  });

  it('stops listening once the board is gone', () => {
    const onTrigger = vi.fn();
    const { unmount } = renderHook(() => useCreateTaskShortcut(onTrigger));

    unmount();
    press(document.body, 'c');

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
