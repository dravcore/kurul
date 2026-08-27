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

/**
 * The label-plus-field block a field sits in, which is what carries the busy mark. Read from
 * the DOM parent rather than by `[aria-busy]`, so that "the mark is gone" is a null attribute
 * on a found element and not a missing element.
 */
function busyWrapper(field: HTMLElement): HTMLElement {
  const wrapper = field.parentElement;
  if (!wrapper) throw new Error('the field is not wrapped');
  return wrapper;
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
      {/* Stands in for whatever the reader tabbed to while the save was in flight. It is outside
          the two fields on purpose: both go `disabled` while pending, which drops focus. */}
      <button type="button">Elsewhere</button>
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

describe('TaskPanelFields size and border', () => {
  it('renders the title at title-lg, borderless at rest with the border back on focus', () => {
    renderFields();

    const title = screen.getByLabelText('Title');
    expect(title.className).toContain('md:text-title-lg');
    expect(title.className).toContain('border-transparent');
    expect(title.className).toContain('focus:border-input');
  });

  it('renders the description at the read step', () => {
    renderFields();

    expect(screen.getByLabelText('Description').className).toContain('md:text-read');
  });
});

describe('TaskPanelFields pending state', () => {
  it('keeps both fields readOnly rather than disabled while a save is in flight, so focus stays put', async () => {
    let resolvePatch: (value: TaskDto) => void = () => undefined;
    apiPatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    renderFields();

    const title = screen.getByLabelText('Title');
    const description = screen.getByLabelText('Description');

    fireEvent.change(title, { target: { value: 'Fix the login redirect' } });
    description.focus();
    fireEvent.blur(title);

    // Pending is set synchronously before the awaited patch resolves.
    expect((title as HTMLInputElement).readOnly).toBe(true);
    expect((description as HTMLTextAreaElement).readOnly).toBe(true);
    expect((title as HTMLInputElement).disabled).toBe(false);
    expect((description as HTMLTextAreaElement).disabled).toBe(false);
    // A `readOnly` field carries none of the semantics `disabled` would have announced, so
    // `aria-busy` is what tells assistive tech the save is in flight (Ruling 4 compensation).
    // It sits on each field's wrapper rather than on the field: the mark describes the region
    // being written, and the control the reader is standing on stays as it was.
    expect(busyWrapper(title).getAttribute('aria-busy')).toBe('true');
    expect(busyWrapper(description).getAttribute('aria-busy')).toBe('true');
    expect(title.getAttribute('aria-busy')).toBeNull();
    expect(description.getAttribute('aria-busy')).toBeNull();
    // The reader was still in the description field; a `disabled` field would have dropped
    // focus to the body the moment the shared pending state applied to it.
    expect(document.activeElement).toBe(description);

    resolvePatch({ ...task(), title: 'Fix the login redirect' });
    await waitFor(() => expect((title as HTMLInputElement).readOnly).toBe(false));
    expect((description as HTMLTextAreaElement).readOnly).toBe(false);
    expect(busyWrapper(title).getAttribute('aria-busy')).toBeNull();
    expect(busyWrapper(description).getAttribute('aria-busy')).toBeNull();
  });

  it('disables both fields outright when the reader cannot mutate the task', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TaskPanelFields
          workspaceId={WORKSPACE_ID}
          task={task()}
          canMutate={false}
          onUpdated={vi.fn()}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(true);
  });
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

  it('leaves focus where the reader moved it', async () => {
    apiPatch.mockRejectedValue(new ApiError({ statusCode: 409, error: 'Conflict', message: 'no' }));
    renderFields();

    editTitle('Fix the login redirect');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();

    await screen.findByRole('alert');

    // The panel saves on blur, so this line arrives after focus has already moved on. Pulling it
    // into the alert would interrupt someone mid-sentence; role="alert" announces it anyway.
    expect(document.activeElement).toBe(elsewhere);
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
