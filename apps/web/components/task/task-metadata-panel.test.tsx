import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { Priority, type TaskDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e02';
const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e03';

// `vi.mock` factories are hoisted above every `const` in this file, so the doubles they close
// over have to be hoisted with them.
const mocks = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Only the transport is faked — `resolveApiMessage` stays real, so these tests exercise the
// same status-to-copy mapping the app runs.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: mocks.post, delete: mocks.delete } };
});

// The panel's own reads are not what these tests are about.
vi.mock('./use-task-metadata', () => ({
  useTaskMetadata: () => ({
    members: [],
    boardLabels: [{ id: LABEL_ID, boardId: BOARD_ID, name: 'Bug', color: 'slot-8' }],
    setBoardLabels: vi.fn(),
    comments: [],
    setComments: vi.fn(),
    hasMoreComments: false,
    loadingMoreComments: false,
    loadMoreComments: vi.fn(),
    activities: [],
    refreshActivities: vi.fn().mockResolvedValue(undefined),
    loadingMeta: false,
    metaFailed: false,
  }),
}));

import { TaskMetadataPanel } from './task-metadata-panel';

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

function renderPanel(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskMetadataPanel
        workspaceId={WORKSPACE_ID}
        boardId={BOARD_ID}
        task={task}
        canMutate
        canManageLabels
        onUpdated={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.delete.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskMetadataPanel error copy', () => {
  it('names the comment, not the task, when posting a comment fails', async () => {
    // These used to fall through to `saveError` — "Could not save this task." — which reports
    // a write the user never made and leaves the one they did make unexplained.
    mocks.post.mockRejectedValue(new Error('network'));
    renderPanel();

    fireEvent.change(screen.getByLabelText(messages.app.board.task.addComment), {
      target: { value: 'Looks right to me' },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.postComment }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(messages.app.board.task.commentError);
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
