import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import {
  Dialog,
  DialogContent,
  DialogDrawerContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

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

/**
 * Content taller than the viewport (`delete-account-dialog.tsx`, one `<select>` per owned
 * workspace) used to be unreachable: Radix locks page scroll and the dialog itself had no
 * height cap, so a short viewport left the footer's submit button off-screen with no way to
 * reach it. The content surface now caps its own height and scrolls itself; the header and
 * footer opt out of that scroll so the submit/cancel controls stay on screen throughout.
 */
describe('DialogContent height boundary', () => {
  it('caps its own height, scrolls internally, and keeps header and footer out of that scroll', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tall dialog</DialogTitle>
            </DialogHeader>
            <div>
              {Array.from({ length: 40 }, (_, index) => (
                <p key={index}>Field {index}</p>
              ))}
            </div>
            <DialogFooter>
              <button type="button">Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </NextIntlClientProvider>,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('max-h-[calc(100dvh-4rem)]');
    expect(content.className).toContain('overflow-y-auto');

    const header = document.querySelector('[data-slot="dialog-header"]');
    expect(header?.className).toContain('sticky');
    expect(header?.className).toContain('top-0');

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    expect(footer?.className).toContain('sticky');
    expect(footer?.className).toContain('bottom-0');
  });

  it('leaves the drawer variant without a height cap or its own scroll', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Dialog open>
          <DialogDrawerContent>
            <p>Drawer content</p>
          </DialogDrawerContent>
        </Dialog>
      </NextIntlClientProvider>,
    );

    const drawer = document.querySelector('[data-slot="dialog-drawer-content"]');
    expect(drawer?.className).not.toContain('max-h-[calc(100dvh-4rem)]');
    expect(drawer?.className).not.toContain('overflow-y-auto');
  });
});
