import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ChecklistSummaryDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ChecklistBadge } from './checklist-badge';

function renderBadge(summary: ChecklistSummaryDto) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChecklistBadge summary={summary} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ChecklistBadge', () => {
  it('renders nothing when the task has no checklist items', () => {
    const { container } = renderBadge({ total: 0, done: 0 });

    // An empty badge would be noise on every card of a board P2-8 spent a whole task making
    // cheap, so "no checklist" has to cost zero nodes rather than one hidden one.
    expect(container.innerHTML).toBe('');
  });

  it('renders done over total', () => {
    renderBadge({ total: 5, done: 2 });

    expect(screen.getByText('2/5')).toBeDefined();
  });

  it('marks a fully done checklist for assistive tech, not by colour alone', () => {
    renderBadge({ total: 3, done: 3 });

    expect(screen.getByLabelText(/complete/i)).toBeDefined();
  });

  it('says how far along an unfinished checklist is instead of leaving the ratio to be parsed', () => {
    renderBadge({ total: 4, done: 1 });

    // The visible "1/4" is a ratio a screen reader reads as "one slash four". The label is the
    // sentence, and it is the second channel `docs/design.md` requires beside the colour.
    expect(screen.getByLabelText('Checklist: 1 of 4 items done')).toBeDefined();
    expect(screen.queryByLabelText(/complete/i)).toBeNull();
  });
});
