import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { Priority, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { TaskPanelFields } from './task-panel-fields';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, patch: vi.fn() } };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const apiPatch = vi.mocked(api.patch);
const toastError = vi.mocked(toast.error);

function task(): TaskDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01',
    boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02',
    columnId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d03',
    title: 'Fix login redirect',
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d04',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  };
}

function renderFields() {
  const onUpdated = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskPanelFields
        workspaceId={WORKSPACE_ID}
        task={task()}
        canMutate
        onUpdated={onUpdated}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
  return { onUpdated, onClose };
}

/** Types a new title and leaves the field, which is the panel's only save gesture. */
function editTitle(value: string): void {
  const input = screen.getByLabelText('Title');
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskPanelFields conflict', () => {
  it('answers a 409 inline rather than with a toast', async () => {
    apiPatch.mockRejectedValue(new ApiError({ statusCode: 409, error: 'Conflict', message: 'no' }));
    renderFields();

    editTitle('Fix the login redirect');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Someone else changed this task. Reload it to edit again.');
    // A conflict is something the reader has to act on, so it stays on the field they were in.
    expect(toastError).not.toHaveBeenCalled();
  });

  it('clears a standing conflict when the next save is attempted', async () => {
    apiPatch.mockRejectedValueOnce(
      new ApiError({ statusCode: 409, error: 'Conflict', message: 'no' }),
    );
    renderFields();

    editTitle('Fix the login redirect');
    await screen.findByRole('alert');

    apiPatch.mockResolvedValueOnce({ ...task(), title: 'Fix the login redirect once' } as never);
    editTitle('Fix the login redirect once');

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('leaves every other failure on the toast it already used', async () => {
    apiPatch.mockRejectedValue(
      new ApiError({ statusCode: 403, error: 'Forbidden', message: 'no' }),
    );
    renderFields();

    editTitle('Fix the login redirect');

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
