import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Textarea } from './textarea';

afterEach(cleanup);

function renderTextarea(props: React.ComponentProps<typeof Textarea> = {}) {
  render(<Textarea aria-label="Description" {...props} />);
  return screen.getByLabelText('Description');
}

describe('Textarea', () => {
  /** The one focus mark is the `:focus-visible` outline in `app/globals.css`; a ring pair here
   * would double it and an `outline-none` would erase it. */
  it('draws no focus mark of its own', () => {
    const element = renderTextarea();

    expect(element.className).not.toMatch(/\bfocus-visible:/);
    expect(element.className).not.toMatch(/\boutline-(none|hidden)\b/);
  });

  /** The two call sites differ only in how tall they start; nothing else may drift with it. */
  it('lets a caller raise the height floor without losing the shared base', () => {
    const element = renderTextarea({ className: 'min-h-32' });

    expect(element.className).toContain('min-h-32');
    expect(element.className).not.toContain('min-h-20');
    expect(element.className).toContain('aria-invalid:border-destructive');
  });

  it('styles the disabled state', () => {
    const element = renderTextarea({ disabled: true });

    expect(element.hasAttribute('disabled')).toBe(true);
    expect(element.className).toContain('disabled:opacity-50');
  });

  /** The comment box turns itself into a combobox for the mention picker. */
  it('passes ARIA attributes through untouched', () => {
    const element = renderTextarea({ role: 'combobox', 'aria-expanded': true });

    expect(element.getAttribute('role')).toBe('combobox');
    expect(element.getAttribute('aria-expanded')).toBe('true');
    expect(element.getAttribute('data-slot')).toBe('textarea');
  });
});
