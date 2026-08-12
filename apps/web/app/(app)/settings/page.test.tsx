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

import SettingsPage from './page';

afterEach(() => {
  cleanup();
});

describe('SettingsPage', () => {
  it('titles the page from the catalog', async () => {
    render(await SettingsPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(messages.app.settings.title);
  });

  it('heads the language section and explains what the choice affects', async () => {
    render(await SettingsPage());

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      messages.app.settings.language.title,
    );
    expect(screen.getByText(messages.app.settings.language.description)).toBeTruthy();
  });

  it('renders the language control', async () => {
    render(await SettingsPage());

    expect(screen.getByTestId('language-settings')).toBeTruthy();
  });

  it('holds no hardcoded copy of its own', async () => {
    // Every user-visible string on this screen has to be catalog-backed, or the Turkish pass
    // will not see it (ADR 0018). The page composes; the strings live in `messages/en.json`.
    const { container } = render(await SettingsPage());

    const rendered = container.textContent ?? '';
    const catalogued = [
      messages.app.settings.title,
      messages.app.settings.language.title,
      messages.app.settings.language.description,
    ];
    for (const text of catalogued) {
      expect(rendered).toContain(text);
    }
    expect(rendered.replace(new RegExp(catalogued.join('|'), 'g'), '').trim()).toBe('');
  });
});
