import { afterEach, describe, expect, it, vi } from 'vitest';
import { Suspense, type ReactElement } from 'react';
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
  it('wraps the confirmation view in a Suspense boundary', async () => {
    const tree = (await VerifyEmailPage()) as ReactElement<{ fallback?: React.ReactNode }>;

    // The boundary is what keeps `useSearchParams` from opting the whole route out of
    // static rendering; without it the build fails rather than degrading quietly.
    expect(tree.type).toBe(Suspense);
    expect(tree.props.fallback).toBeTruthy();

    render(tree);
    expect(screen.getByTestId('verify-email-view')).toBeTruthy();
  });
});
