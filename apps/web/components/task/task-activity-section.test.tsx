import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ActivityDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskActivitySection } from './task-activity-section';

function activity(id: string): ActivityDto {
  return {
    id,
    taskId: 'task-1',
    boardId: 'board-1',
    type: 'task.created',
    payload: { title: 'Fix the login bug' },
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { id: 'u1', name: 'Ayşe Yıldız', avatarUrl: null },
  } as unknown as ActivityDto;
}

function renderSection(overrides: Partial<Parameters<typeof TaskActivitySection>[0]> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskActivitySection activities={[]} loading={false} {...overrides} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TaskActivitySection', () => {
  it('lists the history it is given', () => {
    renderSection({ activities: [activity('a1')] });

    expect(screen.getByText('Ayşe Yıldız')).toBeDefined();
    expect(screen.queryByText(messages.app.board.task.activity.empty)).toBeNull();
  });

  it('says it is empty only once the first fetch has settled', () => {
    renderSection({ loading: true });
    expect(screen.queryByText(messages.app.board.task.activity.empty)).toBeNull();

    cleanup();
    renderSection();
    expect(screen.getByText(messages.app.board.task.activity.empty)).toBeDefined();
  });

  /** "No activity yet" about a list that failed to load is the same lie as an empty inbox. */
  it('reports a failed load instead of claiming there is no history', () => {
    renderSection({ loadFailed: true });

    expect(screen.getByText(messages.app.errors.activityLoad)).toBeDefined();
    expect(screen.queryByText(messages.app.board.task.activity.empty)).toBeNull();
  });
});
