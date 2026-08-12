import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  NextIntlClientProvider,
  createTranslator,
  type NamespaceKeys,
  type NestedKeyOf,
} from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

// `getTranslations` is the server-side reader; the catalogue behind it is the real `en.json`,
// so the copy this page renders is the copy that ships.
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

import NotFound from './not-found';

afterEach(() => {
  cleanup();
});

describe('NotFound', () => {
  it('says the page does not exist and points somewhere that does', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await NotFound()}
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('heading', { name: messages.app.errors.notFoundTitle })).toBeDefined();
    expect(screen.getByText(messages.app.errors.notFoundBody)).toBeDefined();
    expect(
      screen.getByRole('link', { name: messages.app.errors.backHome }).getAttribute('href'),
    ).toBe('/dashboard');
  });
});
