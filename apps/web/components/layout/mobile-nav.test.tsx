import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const nav = vi.hoisted(() => ({ pathname: '/board/abc' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

const signOut = vi.hoisted(() => vi.fn());

vi.mock('./workspace-provider', () => ({
  useWorkspaceContext: () => ({ onSignOut: signOut }),
}));

vi.mock('./workspace-switcher', () => ({
  WorkspaceSwitcher: (): React.ReactElement => <button type="button">Switcher</button>,
}));

vi.mock('./theme-toggle', () => ({
  ThemeToggle: (): React.ReactElement => <button type="button">Theme</button>,
}));

vi.mock('@/components/notification/notification-bell', () => ({
  NotificationBell: (): React.ReactElement => <button type="button">Bell</button>,
}));

vi.mock('@/components/auth/email-verification-link', () => ({
  EmailVerificationLink: (): null => null,
}));

import { MobileNav } from './mobile-nav';

const shell = messages.app.shell;

/**
 * The drawer is a Radix `Dialog`, so the interesting claims are the modal ones — focus goes in
 * and comes back, `Escape` dismisses, the page behind is inert. Those are the reason this is
 * not a hand-rolled panel, and a future "simplification" that swaps the primitive out is
 * exactly what these tests exist to catch.
 *
 * What is deliberately *not* asserted here: any of the 44px sizing. jsdom does not lay
 * anything out — every `getBoundingClientRect` is zeros — so a size assertion in this file
 * would pass whatever the classes said, which is the vacuous-assertion failure mode
 * `docs/testing.md` calls out. The touch targets are measured in a real browser
 * (`e2e/tests/mobile-navigation.spec.ts`), which is the only place the claim means anything.
 */
function renderNav(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {/* A control outside the drawer: what the focus trap has to refuse to reach. */}
      <button type="button">Board control</button>
      <MobileNav />
    </NextIntlClientProvider>,
  );
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: shell.openNavigation });
}

beforeEach(() => {
  nav.pathname = '/board/abc';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MobileNav', () => {
  it('keeps the drawer closed until the hamburger is pressed', () => {
    renderNav();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link', { name: messages.app.dashboard.title })).toBeNull();

    fireEvent.click(trigger());

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('link', { name: messages.app.dashboard.title })).toBeDefined();
  });

  it('names the drawer and its close control from the catalogue', () => {
    renderNav();
    fireEvent.click(trigger());

    // An accessible name is what makes this announce as "Navigation, dialog" rather than as a
    // region the reader has wandered into; `SidebarBody`'s own visible heading is the product
    // name, which names the app and not this layer.
    const dialog = screen.getByRole('dialog', { name: shell.navigation });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByRole('button', { name: shell.closeNavigation })).toBeDefined();
  });

  it('traps focus: the control behind the drawer is not reachable while it is open', () => {
    renderNav();
    const behind = screen.getByRole('button', { name: 'Board control' });

    fireEvent.click(trigger());

    // Radix marks everything outside the content `aria-hidden` and blocks its pointer
    // events, which is what stops Tab and a stray tap from landing on the board.
    expect(behind.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and gives focus back to the hamburger', async () => {
    renderNav();
    fireEvent.click(trigger());
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when a nav row inside it is followed', () => {
    renderNav();
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('link', { name: messages.app.settings.title }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the route changes under it', async () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MobileNav />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: shell.openNavigation }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // App Router navigation does not unmount the shell, so without the pathname effect the
    // drawer would still be sitting over the page it just navigated to. This is the path a
    // link that is *not* one of the two nav rows takes — "New workspace" in the workspace
    // switcher, the confirm-email row — none of which call `onNavigate`.
    nav.pathname = '/workspaces/new';
    await act(async () => {
      rerender(
        <NextIntlClientProvider locale="en" messages={messages}>
          <MobileNav />
        </NextIntlClientProvider>,
      );
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the account controls the desktop sidebar has, not a reduced set', () => {
    renderNav();
    fireEvent.click(trigger());

    const drawer = within(screen.getByRole('dialog'));
    // Same `SidebarBody` as the `<aside>`: workspace switcher, both nav rows, theme, bell and
    // sign out. A mobile navigation that quietly drops one of these is the failure that
    // sharing a component exists to prevent.
    const expected = ['Switcher', 'Theme', 'Bell', shell.signOut, shell.closeNavigation];
    for (const name of expected) {
      expect(
        drawer.getByRole('button', { name }),
        `${name} is missing from the drawer`,
      ).toBeDefined();
    }
    expect(drawer.getByRole('link', { name: messages.app.dashboard.title })).toBeDefined();
    expect(drawer.getByRole('link', { name: messages.app.settings.title })).toBeDefined();
  });
});
