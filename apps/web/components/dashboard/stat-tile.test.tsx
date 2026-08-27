import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatTile } from './stat-tile';

afterEach(() => {
  cleanup();
});

describe('StatTile', () => {
  it('sets the hero figure in a named type-scale step, not an arbitrary value', () => {
    render(<StatTile label="Open tasks" value={128} />);

    const figure = screen.getByText('128');
    expect(figure.className.split(/\s+/)).toContain('text-stat');
    expect(figure.className).not.toMatch(/text-\[28px\]/);
  });

  /** docs/design.md §8: the value carries "proportional" figures, never `tabular-nums`. */
  it('does not force tabular figures on the value', () => {
    render(<StatTile label="Overdue" value={3} emphasize />);

    const figure = screen.getByText('3');
    expect(figure.className).not.toMatch(/\btabular-nums\b/);
  });
});

/**
 * `text-stat` has to draw its own line box: at 28px, the body's inherited 18px line-height
 * clips ascenders and descenders instead of giving the figure the room `docs/design.md` §8
 * describes. Read from `globals.css` itself, the same way `app/globals.contrast.test.ts` reads
 * its tokens: the value can only drift here if the CSS itself changes.
 */
describe('the --text-stat step in app/globals.css', () => {
  const globalsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../app/globals.css',
  );
  const css = readFileSync(globalsPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('declares a line-height of its own, not the inherited 18px body leading', () => {
    const match = /--text-stat--line-height:\s*([^;]+);/.exec(css);
    expect(match?.[1]?.trim()).toBeDefined();
    expect(match?.[1]?.trim()).not.toBe('18px');
  });

  it('sets the 28px size docs/design.md §8 names for the hero figure', () => {
    const match = /--text-stat:\s*([^;]+);/.exec(css);
    expect(match?.[1]?.trim()).toBe('28px');
  });
});
