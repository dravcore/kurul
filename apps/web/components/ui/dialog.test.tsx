import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/**
 * Radix returns focus to `DialogTrigger`, which none of these dialogs use: they are opened by
 * setting `open` from a button somewhere else in the tree, and Radix's restore then reaches for
 * a trigger that was never rendered and leaves the keyboard user on `<body>`.
 */
describe('DialogContent focus return', () => {
  function Harness(): React.ReactElement {
    const [open, setOpen] = useState(false);
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <button type="button" onClick={() => setOpen(true)}>
          Delete task
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Delete this task?</DialogTitle>
          </DialogContent>
        </Dialog>
      </NextIntlClientProvider>
    );
  }

  it('hands focus back to the control that opened it', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Delete task' });
    opener.focus();
    fireEvent.click(opener);
    const content = screen.getByRole('dialog');

    fireEvent.keyDown(content, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix runs the restore on a task of its own rather than inside the keystroke.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
