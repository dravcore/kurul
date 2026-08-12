import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/auth/verify-email-view', () => ({
  VerifyEmailView: (): React.ReactElement => <div data-testid="verify-email-view" />,
}));

import VerifyEmailPage from './page';

afterEach(() => {
  cleanup();
});

describe('VerifyEmailPage', () => {
  it('renders the confirmation view behind a Suspense boundary', async () => {
    render(await VerifyEmailPage());

    // The boundary is what keeps `useSearchParams` from opting the whole route out of
    // static rendering; without it the build fails rather than degrading quietly.
    expect(screen.getByTestId('verify-email-view')).toBeTruthy();
  });
});
