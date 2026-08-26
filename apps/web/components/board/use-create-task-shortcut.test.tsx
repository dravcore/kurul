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

/** The panel as the guard reads it: one `data-slot`, and whatever is focused inside it. */
function mountTaskPanel(): HTMLElement {
  const panel = mount(document.createElement('aside'));
  panel.setAttribute('data-slot', 'task-panel');
  return panel;
}

/**
 * A `matchMedia` double answering `matches` for the width query and nothing else.
 *
 * jsdom implements no `matchMedia` at all, which is itself one of the cases the hook handles, so
 * the tests that do not stub it are testing the wide board as much as the missing API.
 */
function stubViewportBelowMd(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query === '(width < 48rem)' ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
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

  /**
   * The panel is an `<aside>`, not a dialog, so the `role="dialog"` guard above never sees it.
   * At any width, a `c` pressed on one of its controls belongs to the task being read.
   */
  it('stays out of the task panel at any width', () => {
    const onTrigger = vi.fn();
    renderHook(() => useCreateTaskShortcut(onTrigger));
    const inside = document.createElement('button');
    mountTaskPanel().append(inside);

    expect(press(inside, 'c')).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  /**
   * Below `md` the panel is `fixed inset-0` over the whole board, so a composer opened from
   * anywhere would put the caret in a field behind it. The key is unarmed while it is mounted.
   */
  it('unarms the key while the panel covers the board below md', () => {
    const onTrigger = vi.fn();
    stubViewportBelowMd(true);
    renderHook(() => useCreateTaskShortcut(onTrigger));
    mountTaskPanel();

    expect(press(document.body, 'c')).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('still opens the composer beside an open panel on a wide board', () => {
    const onTrigger = vi.fn();
    stubViewportBelowMd(false);
    renderHook(() => useCreateTaskShortcut(onTrigger));
    mountTaskPanel();

    expect(press(document.body, 'c')).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('opens the composer on a narrow board with no panel open', () => {
    const onTrigger = vi.fn();
    stubViewportBelowMd(true);
    renderHook(() => useCreateTaskShortcut(onTrigger));

    expect(press(document.body, 'c')).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
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
