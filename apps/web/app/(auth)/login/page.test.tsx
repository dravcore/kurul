import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/auth/login-view', () => ({
  LoginView: (): React.ReactElement => <div data-testid="login-view" />,
}));

import LoginPage from './page';

afterEach(() => {
  cleanup();
});

describe('LoginPage', () => {
  it('renders the sign-in form behind a Suspense boundary', async () => {
    render(await LoginPage());

    // The boundary is what keeps the form's `useSearchParams` — how `?next=…` is read — from
    // opting the whole route out of static rendering; without it the build fails rather than
    // degrading quietly.
    expect(screen.getByTestId('login-view')).toBeTruthy();
  });
});
