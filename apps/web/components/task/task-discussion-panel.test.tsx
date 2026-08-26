import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import {
  ActivityType,
  MemberRole,
  Priority,
  type CommentDto,
  type TaskDto,
} from '@kurul/shared-types';
import messages from '@/messages/en.json';
import type { UseTaskMetadataResult } from './use-task-metadata';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e02';
const COMMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e07';
const MEMBER_USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e06';

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

import { TaskDiscussionPanel } from './task-discussion-panel';

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

const comment: CommentDto = {
  id: COMMENT_ID,
  taskId: TASK_ID,
  userId: MEMBER_USER_ID,
  body: 'Looks right to me',
  createdAt: '2026-08-12T10:00:00.000Z',
  author: { id: MEMBER_USER_ID, name: 'Ayşe Yıldız', avatarUrl: null, deleted: false },
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
    boardLabels: [],
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
      <TaskDiscussionPanel workspaceId={WORKSPACE_ID} task={task} canMutate meta={meta} />
    </NextIntlClientProvider>,
  );
  return meta;
}

const discussionRegion = (): HTMLElement =>
  screen.getByRole('region', { name: messages.app.board.task.discussionTitle });

beforeEach(() => {
  mocks.post.mockReset();
  mocks.delete.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The discussion half of the old `TaskMetadataPanel`. It sits at the bottom of the panel, after
 * the checklists and attachments, so it has to stand on its own.
 */
describe('TaskDiscussionPanel', () => {
  it('gathers the thread and the history under one named region', () => {
    renderPanel(
      metaStub({
        comments: [comment],
        activities: [
          {
            id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e08',
            workspaceId: WORKSPACE_ID,
            taskId: TASK_ID,
            userId: MEMBER_USER_ID,
            type: ActivityType.TaskCreated,
            payload: { title: task.title },
            createdAt: '2026-08-12T09:00:00.000Z',
            author: { id: MEMBER_USER_ID, name: 'Ayşe Yıldız', avatarUrl: null, deleted: false },
          },
        ],
      }),
    );
    const region = discussionRegion();

    expect(within(region).getByText(messages.app.board.task.comments)).toBeDefined();
    expect(within(region).getByText(messages.app.board.task.activity.title)).toBeDefined();
    expect(within(region).getByLabelText(messages.app.board.task.addComment)).toBeDefined();
  });

  it('leaves the task properties to the properties panel', () => {
    renderPanel();

    expect(screen.queryByLabelText(messages.app.board.task.priority)).toBeNull();
    expect(screen.queryByText(messages.app.board.task.labels)).toBeNull();
  });

  it('refreshes the shared history after a comment is posted', async () => {
    mocks.post.mockResolvedValue(comment);
    const meta = renderPanel();

    fireEvent.change(screen.getByLabelText(messages.app.board.task.addComment), {
      target: { value: 'Looks right to me' },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.postComment }));

    await waitFor(() => expect(meta.refreshActivities).toHaveBeenCalled());
    expect(meta.setComments).toHaveBeenCalled();
  });

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

  it('names the comment delete, not the task, when it fails', async () => {
    mocks.delete.mockRejectedValue(new Error('network'));
    renderPanel(metaStub({ comments: [comment] }));

    fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.deleteComment }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(messages.app.board.task.commentDeleteError);
  });
});
