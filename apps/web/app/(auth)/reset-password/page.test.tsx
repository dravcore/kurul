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

vi.mock('@/components/auth/reset-password-view', () => ({
  ResetPasswordView: (): React.ReactElement => <div data-testid="reset-password-view" />,
}));

import ResetPasswordPage from './page';

afterEach(() => {
  cleanup();
});

describe('ResetPasswordPage', () => {
  it('wraps the reset form in a Suspense boundary', async () => {
    const tree = (await ResetPasswordPage()) as ReactElement<{ fallback?: React.ReactNode }>;

    // The boundary is what keeps `useSearchParams` (how `?token=` is read) from opting the
    // whole route out of static rendering; without it the build fails rather than degrading
    // quietly.
    expect(tree.type).toBe(Suspense);
    expect(tree.props.fallback).toBeTruthy();

    render(tree);
    expect(screen.getByTestId('reset-password-view')).toBeTruthy();
  });
});
