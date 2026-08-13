import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/layout/topbar', () => ({
  Topbar: ({ title }: Readonly<{ title: string }>): React.ReactElement => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

vi.mock('@/components/settings/language-settings', () => ({
  LanguageSettings: (): React.ReactElement => <div data-testid="language-settings" />,
}));

vi.mock('@/components/settings/members-settings', () => ({
  MembersSettings: (): React.ReactElement => <div data-testid="members-settings" />,
}));

vi.mock('@/components/settings/workspace-settings', () => ({
  WorkspaceSettings: (): React.ReactElement => <div data-testid="workspace-settings" />,
}));

import SettingsPage from './page';

afterEach(() => {
  cleanup();
});

describe('SettingsPage', () => {
  it('titles the page from the catalog', async () => {
    render(await SettingsPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(messages.app.settings.title);
  });

  it('heads each section and explains what the section decides', async () => {
    render(await SettingsPage());

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    // Members before Language before Workspace: the section a new owner comes here to find
    // leads, and the one irreversible control (delete) trails everything read routinely.
    expect(headings).toEqual([
      messages.app.settings.members.title,
      messages.app.settings.language.title,
      messages.app.settings.workspace.title,
    ]);
    expect(screen.getByText(messages.app.settings.members.description)).toBeTruthy();
    expect(screen.getByText(messages.app.settings.language.description)).toBeTruthy();
    expect(screen.getByText(messages.app.settings.workspace.description)).toBeTruthy();
  });

  it('mounts every section body', async () => {
    render(await SettingsPage());

    expect(screen.getByTestId('members-settings')).toBeTruthy();
    expect(screen.getByTestId('language-settings')).toBeTruthy();
    expect(screen.getByTestId('workspace-settings')).toBeTruthy();
  });

  it('holds no hardcoded copy of its own', async () => {
    // Every user-visible string on this screen has to be catalog-backed, or the Turkish pass
    // will not see it (ADR 0018). The page composes; the strings live in `messages/en.json`.
    const { container } = render(await SettingsPage());

    const rendered = container.textContent ?? '';
    const catalogued = [
      messages.app.settings.title,
      messages.app.settings.members.title,
      messages.app.settings.members.description,
      messages.app.settings.language.title,
      messages.app.settings.language.description,
      messages.app.settings.workspace.title,
      messages.app.settings.workspace.description,
    ];
    for (const text of catalogued) {
      expect(rendered).toContain(text);
    }
    expect(rendered.replace(new RegExp(catalogued.join('|'), 'g'), '').trim()).toBe('');
  });
});
