import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskCard } from './task-card';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    boardId: 'board-1',
    columnId: 'column-1',
    title: 'Task',
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    ...overrides,
  };
}

function renderCard(overrides: Partial<TaskDto> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskCard task={task(overrides)} boardId="board-1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TaskCard estimate', () => {
  it('renders 150 minutes as hours and minutes, not as raw minutes', () => {
    renderCard({ estimatedMinutes: 150 });

    expect(screen.getByText('2h 30m')).toBeDefined();
    expect(screen.queryByText('150m')).toBeNull();
  });

  it('drops the minutes on a whole hour', () => {
    renderCard({ estimatedMinutes: 120 });

    expect(screen.getByText('2h')).toBeDefined();
    expect(screen.queryByText('2h 0m')).toBeNull();
  });

  it('stays in minutes under an hour', () => {
    renderCard({ estimatedMinutes: 45 });

    expect(screen.getByText('45m')).toBeDefined();
  });

  it('renders a zero estimate rather than swallowing it', () => {
    renderCard({ estimatedMinutes: 0 });

    expect(screen.getByText('0m')).toBeDefined();
  });

  it('shows no estimate at all when the task has none', () => {
    renderCard({ estimatedMinutes: null });

    expect(screen.queryByText(/\dh|\dm/)).toBeNull();
  });
});

describe('TaskCard checklist badge', () => {
  it('carries checklist progress on a card that has nothing else in its meta row', () => {
    // The meta row is conditional. Before the badge was added to that condition, a task whose
    // only metadata was a checklist rendered no row at all and the badge went missing.
    renderCard({ checklistSummary: { total: 4, done: 1 } });

    expect(screen.getByText('1/4')).toBeDefined();
  });

  it('adds nothing to a card whose task has no checklist', () => {
    renderCard({ checklistSummary: { total: 0, done: 0 } });

    expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
  });
});
