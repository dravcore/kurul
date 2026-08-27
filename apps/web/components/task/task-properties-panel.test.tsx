import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { MemberRole, Priority, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import type { UseTaskMetadataResult } from './use-task-metadata';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e02';
const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e03';
const MEMBER_USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e06';

// `vi.mock` factories are hoisted above every `const` in this file, so the doubles they close
// over have to be hoisted with them.
const mocks = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Only the transport is faked (`resolveApiMessage` stays real), so these tests exercise the
// same status-to-copy mapping the app runs.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, post: mocks.post, delete: mocks.delete, patch: mocks.patch },
  };
});

import { TaskPropertiesPanel } from './task-properties-panel';

const task: TaskDto = {
  id: TASK_ID,
  boardId: BOARD_ID,
  columnId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e04',
  title: 'Wire the socket',
  description: null,
  position: 1000,
  priority: Priority.MEDIUM,
  dueDate: null,
  estimatedMinutes: null,
  assignees: [],
  labels: [],
  checklistSummary: { total: 0, done: 0 },
  checklists: null,
  attachmentCount: 0,
  createdById: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e05',
  createdAt: '2026-08-12T09:00:00.000Z',
  updatedAt: '2026-08-12T09:00:00.000Z',
};

/** The shared read `TaskPanel` owns; this panel only consumes it. */
function metaStub(overrides: Partial<UseTaskMetadataResult> = {}): UseTaskMetadataResult {
  return {
    members: [
      {
        id: 'm1',
        workspaceId: WORKSPACE_ID,
        userId: MEMBER_USER_ID,
        role: MemberRole.MEMBER,
        name: 'Ayşe Yıldız',
        avatarUrl: null,
      },
    ],
    boardLabels: [{ id: LABEL_ID, boardId: BOARD_ID, name: 'Bug', color: 'slot-8' }],
    setBoardLabels: vi.fn(),
    comments: [],
    setComments: vi.fn(),
    hasMoreComments: false,
    loadingMoreComments: false,
    loadMoreComments: vi.fn().mockResolvedValue(undefined),
    activities: [],
    refreshActivities: vi.fn().mockResolvedValue(undefined),
    loadingMeta: false,
    metaFailed: false,
    ...overrides,
  };
}

function renderPanel(meta: UseTaskMetadataResult = metaStub()): UseTaskMetadataResult {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskPropertiesPanel
        workspaceId={WORKSPACE_ID}
        boardId={BOARD_ID}
        task={task}
        canMutate
        canManageLabels
        meta={meta}
        onUpdated={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return meta;
}

const propertiesRegion = (): HTMLElement =>
  screen.getByRole('region', { name: messages.app.board.task.propertiesTitle });

beforeEach(() => {
  mocks.post.mockReset();
  mocks.delete.mockReset();
  mocks.patch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The properties half of the old `TaskMetadataPanel`. It has to stand on its own because the
 * checklist and attachment surfaces now sit between it and the discussion below.
 */
describe('TaskPropertiesPanel', () => {
  it('gathers the task properties under one named region', () => {
    renderPanel();
    const region = propertiesRegion();

    expect(within(region).getByLabelText(messages.app.board.task.priority)).toBeDefined();
    expect(within(region).getByLabelText(messages.app.board.task.dueDate)).toBeDefined();
    expect(within(region).getByLabelText(messages.app.board.task.estimate)).toBeDefined();
    expect(within(region).getByText(messages.app.board.task.assignees)).toBeDefined();
    expect(within(region).getByText(messages.app.board.task.labels)).toBeDefined();
  });

  it('hands both sections the counts the threshold is read off', () => {
    // The workspace roster and the board palette are read once, by the panel above this one, so
    // this is the only place the two counts the threshold turns on actually come from.
    renderPanel(
      metaStub({
        members: Array.from({ length: 8 }, (_, index) => ({
          id: `m${index + 1}`,
          workspaceId: WORKSPACE_ID,
          userId: `${MEMBER_USER_ID.slice(0, -1)}${index}`,
          role: MemberRole.MEMBER,
          name: `Member ${index + 1}`,
          avatarUrl: null,
        })),
        boardLabels: Array.from({ length: 8 }, (_, index) => ({
          id: `l${index + 1}`,
          boardId: BOARD_ID,
          name: `Label ${index + 1}`,
          color: 'slot-1' as const,
        })),
      }),
    );
    const region = propertiesRegion();

    expect(within(region).getByRole('button', { name: /^Assign/ })).toBeDefined();
    expect(within(region).getByRole('button', { name: /^Add label/ })).toBeDefined();
  });

  it('leaves the comment thread and the history to the discussion panel', () => {
    renderPanel();

    expect(screen.queryByLabelText(messages.app.board.task.addComment)).toBeNull();
    expect(screen.queryByText(messages.app.board.task.activity.title)).toBeNull();
  });

  it('refreshes the shared history after an assignee changes', async () => {
    mocks.post.mockResolvedValue(task);
    const meta = renderPanel();

    fireEvent.click(screen.getByLabelText('Ayşe Yıldız'));

    await waitFor(() => expect(meta.refreshActivities).toHaveBeenCalled());
  });

  it('confirms a label delete, because its blast radius is off screen', async () => {
    // The palette row and this task's chip vanish; that the label also left every other task
    // on the board is invisible, so the confirmation is what carries the scope.
    mocks.delete.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.deleteLabel }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(messages.app.board.task.labelDeleted);
  });

  it('names the label delete, not a label update, when it fails', async () => {
    mocks.delete.mockRejectedValue(new Error('network'));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.deleteLabel }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(messages.app.board.task.labelDeleteError);
  });
});

/**
 * The whole panel used to share one `pending` flag, so any write re-rendered every field as
 * `disabled` and the browser blurred whichever one the reader was holding. These fire a real
 * change against a request that never settles, which is the state the old flag was wrong in.
 *
 * jsdom does not run the browser's focus fixup, so `document.activeElement` cannot fail here on
 * its own: the assertion that carries the guarantee in a real browser is `disabled === false`.
 */
describe('TaskPropertiesPanel while a write is out', () => {
  /** Leaves the mocked call unresolved for the rest of the test. */
  function neverSettles(mock: { mockImplementation: (impl: () => Promise<never>) => void }): void {
    mock.mockImplementation(() => new Promise<never>(() => {}));
  }

  const priority = (): HTMLSelectElement => screen.getByLabelText(messages.app.board.task.priority);
  const due = (): HTMLInputElement => screen.getByLabelText(messages.app.board.task.dueDate);
  const estimate = (): HTMLInputElement => screen.getByLabelText(messages.app.board.task.estimate);
  const liveRegion = (): HTMLElement => within(propertiesRegion()).getByRole('status');

  it('keeps the priority select focused instead of disabling it', async () => {
    neverSettles(mocks.patch);
    renderPanel();
    priority().focus();

    fireEvent.change(priority(), { target: { value: Priority.URGENT } });

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(document.activeElement).toBe(priority());
    expect(priority().disabled).toBe(false);
    expect(priority().getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the due-date field focused and readOnly', async () => {
    neverSettles(mocks.patch);
    renderPanel();
    due().focus();

    fireEvent.change(due(), { target: { value: '2026-09-01' } });

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(document.activeElement).toBe(due());
    expect(due().disabled).toBe(false);
    expect(due().readOnly).toBe(true);
  });

  it('leaves the estimate the reader is typing in alone while another field saves', async () => {
    neverSettles(mocks.patch);
    renderPanel();
    fireEvent.change(priority(), { target: { value: Priority.URGENT } });
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());

    estimate().focus();
    fireEvent.change(estimate(), { target: { value: '45' } });

    expect(document.activeElement).toBe(estimate());
    expect(estimate().disabled).toBe(false);
    expect(estimate().readOnly).toBe(false);
    expect(estimate().value).toBe('45');
  });

  it('keeps the assignee checkbox focused while its own toggle is out', async () => {
    neverSettles(mocks.post);
    renderPanel();
    const box = screen.getByLabelText('Ayşe Yıldız') as HTMLInputElement;
    box.focus();

    fireEvent.click(box);

    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(document.activeElement).toBe(box);
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the label checkbox focused while its own toggle is out', async () => {
    neverSettles(mocks.post);
    renderPanel();
    const box = screen.getByLabelText('Bug') as HTMLInputElement;
    box.focus();

    fireEvent.click(box);

    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(document.activeElement).toBe(box);
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-disabled')).toBe('true');
  });

  it('announces the write from a section live region rather than from the control', async () => {
    neverSettles(mocks.patch);
    renderPanel();

    expect(liveRegion().textContent).toBe('');
    expect(liveRegion().getAttribute('aria-busy')).toBeNull();

    fireEvent.change(priority(), { target: { value: Priority.URGENT } });

    await waitFor(() => expect(liveRegion().getAttribute('aria-busy')).toBe('true'));
    expect(liveRegion().textContent).toBe(messages.app.board.task.saving);
    expect(priority().getAttribute('aria-busy')).toBeNull();
  });

  it('gates only the row whose write is out, not the section around it', async () => {
    neverSettles(mocks.post);
    renderPanel();

    fireEvent.click(screen.getByLabelText('Ayşe Yıldız'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());

    expect(priority().getAttribute('aria-disabled')).toBeNull();
    expect(due().readOnly).toBe(false);
    expect(
      (screen.getByLabelText('Bug') as HTMLInputElement).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
