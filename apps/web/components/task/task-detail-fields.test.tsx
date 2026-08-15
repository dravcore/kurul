import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskDetailFields } from './task-detail-fields';

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
    attachmentCount: 0,
    ...overrides,
  };
}

function renderFields(overrides: Partial<TaskDto> = {}, disabled = false) {
  const onPatch = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskDetailFields task={task(overrides)} disabled={disabled} onPatch={onPatch} />
    </NextIntlClientProvider>,
  );
  return { onPatch };
}

const estimate = (): HTMLInputElement => screen.getByLabelText('Estimate (minutes)');

afterEach(() => {
  cleanup();
});

describe('TaskDetailFields', () => {
  it('patches the selected priority', () => {
    const { onPatch } = renderFields();

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: Priority.URGENT } });

    expect(onPatch).toHaveBeenCalledWith({ priority: Priority.URGENT });
  });

  it('sends a due date as midday UTC so a local timezone cannot shift the day', () => {
    const { onPatch } = renderFields();

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-03-04' } });

    expect(onPatch).toHaveBeenCalledWith({ dueDate: '2026-03-04T12:00:00.000Z' });
  });

  it('clears the due date with an explicit null', () => {
    const { onPatch } = renderFields({ dueDate: '2026-03-04T12:00:00.000Z' });
    const input: HTMLInputElement = screen.getByLabelText('Due date');
    expect(input.value).toBe('2026-03-04');

    fireEvent.change(input, { target: { value: '' } });

    expect(onPatch).toHaveBeenCalledWith({ dueDate: null });
  });

  it('holds the estimate as a draft until blur', () => {
    const { onPatch } = renderFields();

    fireEvent.change(estimate(), { target: { value: '9' } });
    fireEvent.change(estimate(), { target: { value: '90' } });
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.blur(estimate());

    // One request for the finished number, not one per keystroke.
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ estimatedMinutes: 90 });
  });

  it('does not patch when the blurred estimate is unchanged', () => {
    const { onPatch } = renderFields({ estimatedMinutes: 60 });
    expect(estimate().value).toBe('60');

    fireEvent.blur(estimate());

    expect(onPatch).not.toHaveBeenCalled();
  });

  it('clears a set estimate but stays quiet when it was already empty', () => {
    const { onPatch } = renderFields({ estimatedMinutes: 60 });

    fireEvent.change(estimate(), { target: { value: '' } });
    fireEvent.blur(estimate());
    expect(onPatch).toHaveBeenCalledWith({ estimatedMinutes: null });

    cleanup();
    const empty = renderFields();
    fireEvent.change(estimate(), { target: { value: '' } });
    fireEvent.blur(estimate());
    expect(empty.onPatch).not.toHaveBeenCalled();
  });

  it('locks every field when the panel is disabled', () => {
    const { onPatch } = renderFields({}, true);

    expect((screen.getByLabelText('Priority') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Due date') as HTMLInputElement).disabled).toBe(true);
    expect(estimate().disabled).toBe(true);
    expect(onPatch).not.toHaveBeenCalled();
  });
});
