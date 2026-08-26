import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Select } from './select';

afterEach(cleanup);

function renderSelect(props: React.ComponentProps<typeof Select> = {}) {
  render(
    <Select aria-label="Colour" {...props}>
      <option value="slot-1">slot-1</option>
    </Select>,
  );
  return screen.getByLabelText('Colour');
}

describe('Select', () => {
  /**
   * The reason this component exists: the same control was hand-styled in three places and
   * one of them had lost its focus ring entirely. Keyboard visibility is not a per-call-site
   * decision, and since Phase 4 the way to honour it is to add nothing: the one mark is the
   * `:focus-visible` outline in `app/globals.css`, which any `focus-visible:` ring or
   * `outline-none` here would either double or erase.
   */
  it('draws no focus mark of its own at either size', () => {
    for (const size of ['default', 'sm'] as const) {
      cleanup();
      const element = renderSelect({ size });
      expect(element.className).not.toMatch(/\bfocus-visible:/);
      expect(element.className).not.toMatch(/\boutline-(none|hidden)\b/);
    }
  });

  it('keeps the shared base when the caller adds layout classes', () => {
    const element = renderSelect({ className: 'min-w-[10rem]' });

    expect(element.className).toContain('min-w-[10rem]');
    expect(element.className).toContain('aria-invalid:border-destructive');
  });

  it('styles the disabled state rather than leaving it to each call site', () => {
    const element = renderSelect({ disabled: true });

    expect(element.hasAttribute('disabled')).toBe(true);
    expect(element.className).toContain('disabled:opacity-50');
    expect(element.className).toContain('disabled:cursor-not-allowed');
  });

  it('renders a real select so options and labels stay native', () => {
    const element = renderSelect();

    expect(element.tagName).toBe('SELECT');
    expect(element.getAttribute('data-slot')).toBe('select');
    expect(screen.getByRole('option', { name: 'slot-1' })).toBeDefined();
  });

  it('sizes to h-8 for the compact variant and h-9 otherwise', () => {
    expect(renderSelect({ size: 'sm' }).className).toContain('h-8');
    cleanup();
    expect(renderSelect().className).toContain('h-9');
  });
});
