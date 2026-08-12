import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import messages from '@/messages/en.json';

// The message catalogue stays real, so a renamed or missing key fails this test instead of
// silently rendering the key path in production.
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/layout/topbar', () => ({
  Topbar: ({ title }: Readonly<{ title: string }>): React.ReactElement => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

vi.mock('@/components/dashboard/dashboard-summary', () => ({
  DashboardSummary: (): React.ReactElement => <div data-testid="dashboard-summary" />,
}));

vi.mock('@/components/board/board-list', () => ({
  BoardList: (): React.ReactElement => <div data-testid="board-list" />,
}));

import DashboardPage from './page';

afterEach(() => {
  cleanup();
});

describe('DashboardPage', () => {
  it('titles the topbar from the dashboard namespace', async () => {
    render(await DashboardPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Boards' })).toBeTruthy();
  });

  it('renders the summary and the board list side by side', async () => {
    render(await DashboardPage());

    expect(screen.getByTestId('dashboard-summary')).toBeTruthy();
    expect(screen.getByTestId('board-list')).toBeTruthy();
  });
});
