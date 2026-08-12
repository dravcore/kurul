import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog';

/**
 * The close affordances are the only copy the dialog primitive owns. Both are easy to miss:
 * the corner button's label is screen-reader-only, and the footer button is opt-in. A
 * hardcoded English string in either is invisible to a translation pass, so they are asserted
 * against the real catalogue rather than against a literal.
 */
function renderDialog(footerCloseButton = false): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Board</DialogTitle>
          <DialogFooter showCloseButton={footerCloseButton} />
        </DialogContent>
      </Dialog>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('DialogContent', () => {
  it('gives the icon-only close button an accessible name from the catalogue', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: messages.common.close })).toBeDefined();
  });
});

describe('DialogFooter', () => {
  it('omits the close button unless asked for one', () => {
    renderDialog(false);

    // Only the corner button, not a second one in the footer.
    expect(screen.getAllByRole('button', { name: messages.common.close })).toHaveLength(1);
  });

  it('translates the opt-in footer close button', () => {
    renderDialog(true);

    expect(screen.getAllByRole('button', { name: messages.common.close })).toHaveLength(2);
  });
});
