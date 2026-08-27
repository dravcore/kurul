import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { WorkspaceDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { WorkspaceSwitcher } from './workspace-switcher';

const WORKSPACE: WorkspaceDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00',
  name: 'Kurul',
  slug: 'kurul',
  createdAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('./workspace-provider', () => ({
  useWorkspaceContext: () => ({
    workspaces: [WORKSPACE],
    activeId: WORKSPACE.id,
    onSwitch: vi.fn(),
  }),
}));

function renderSwitcher(collapsed: boolean): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkspaceSwitcher collapsed={collapsed} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('WorkspaceSwitcher, collapsed', () => {
  /**
   * The 56px rail shows nothing but a 24px initial-letter chip, so this trigger is the only
   * place the active workspace's name can still reach a reader: a `title` for a pointer that
   * rests on it, and the accessible name (`aria-label`) for anyone using a screen reader who
   * never rests a pointer on anything at all.
   */
  it('exposes the active workspace name to a pointer and to assistive tech', () => {
    renderSwitcher(true);

    const trigger = screen.getByRole('button', {
      name: messages.app.shell.switchWorkspaceNamed.replace('{name}', WORKSPACE.name),
    });
    expect(trigger.getAttribute('title')).toBe(WORKSPACE.name);
  });
});

describe('WorkspaceSwitcher, expanded', () => {
  /** The name is already on screen as text; the trigger's accessible name is that text alone. */
  it('does not carry a pointer title once the name is already visible', () => {
    renderSwitcher(false);

    const trigger = screen.getByRole('button', { name: WORKSPACE.name });
    expect(trigger.getAttribute('title')).toBeNull();
  });
});
