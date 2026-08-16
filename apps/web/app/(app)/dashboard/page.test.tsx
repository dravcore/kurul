import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import messages from '@/messages/en.json';

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

// The message catalogue stays real, so a renamed or missing key fails this test instead of
// silently rendering the key path in production.
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

const mocks = vi.hoisted(() => ({
  loading: false,
}));

vi.mock('@/components/dashboard/dashboard-summary', () => ({
  DashboardSummary: (): React.ReactElement => {
    // Throwing a promise that never settles is how a component tells React it is still
    // loading — the one way to get the page's own fallback on screen from a test.
    if (mocks.loading) {
      throw new Promise<void>(() => {});
    }
    return <div data-testid="dashboard-summary" />;
  },
}));

vi.mock('@/components/board/board-list', () => ({
  BoardList: (): React.ReactElement => <div data-testid="board-list" />,
}));

import DashboardPage from './page';

beforeEach(() => {
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
});

describe('DashboardPage', () => {
  it('titles the topbar from the dashboard namespace', async () => {
    render(await DashboardPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Boards' })).toBeTruthy();
  });

  it('keeps the rest of the page while only the summary is still loading', async () => {
    mocks.loading = true;

    const { container } = render(await DashboardPage());

    expect(screen.queryByTestId('dashboard-summary')).toBeNull();
    // Two stat tiles and the chart beneath them, so the summary does not push the boards
    // list down the page when it arrives.
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    // The boundary is around the summary alone: the board list is not waiting on it.
    expect(screen.getByTestId('board-list')).toBeTruthy();
  });
});
