'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { CommentDto, CreateCommentRequest, TaskDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { TaskActivitySection } from './task-activity-section';
import { TaskCommentsSection } from './task-comments-section';
import type { UseTaskMetadataResult } from './use-task-metadata';

interface TaskDiscussionPanelProps {
  workspaceId: string;
  task: TaskDto;
  canMutate: boolean;
  /** The same shared read `TaskPropertiesPanel` above it consumes; see the note there. */
  meta: UseTaskMetadataResult;
}

/**
 * What people said about the task: the comment thread and the history it lands in.
 *
 * Last of the panel's sections, because it is the one a reader scrolls to rather than the one
 * they open the card for. The delete footer below it is `mt-auto` and stays the last child of
 * the scroll column, so nothing may be appended after this.
 */
export function TaskDiscussionPanel({
  workspaceId,
  task,
  canMutate,
  meta,
}: TaskDiscussionPanelProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const [pending, setPending] = useState(false);

  const {
    members,
    comments,
    setComments,
    hasMoreComments,
    loadingMoreComments,
    loadMoreComments,
    activities,
    refreshActivities,
    loadingMeta,
    metaFailed,
  } = meta;

  /**
   * Names the object the caller actually touched, rather than the task it hangs off.
   *
   * Comment writes used to fall through to `saveError` — "Could not save this task." — which
   * describes a write the user did not make and leaves the comment they did make unexplained.
   */
  function toastObjectError(caught: unknown, fallback: string): void {
    toast.error(resolveApiMessage(caught, t, { fallback, byStatus: { 403: 'forbidden' } }));
  }

  async function submitComment(body: string): Promise<boolean> {
    if (!canMutate) return false;
    setPending(true);
    try {
      const payload: CreateCommentRequest = { body };
      const created = await api.post<CommentDto, CreateCommentRequest>(
        `/workspaces/${workspaceId}/tasks/${task.id}/comments`,
        payload,
      );
      setComments((current) => [...current, created]);
      await refreshActivities();
      return true;
    } catch (caught) {
      toastObjectError(caught, 'commentError');
      return false;
    } finally {
      setPending(false);
    }
  }

  async function removeComment(commentId: string): Promise<void> {
    if (!canMutate) return;
    setPending(true);
    try {
      await api.delete(`/workspaces/${workspaceId}/comments/${commentId}`);
      setComments((current) => current.filter((comment) => comment.id !== commentId));
    } catch (caught) {
      toastObjectError(caught, 'commentDeleteError');
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label={t('discussionTitle')}
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <p className="text-small font-strong text-foreground">{t('discussionTitle')}</p>

      <div className="flex flex-col gap-5">
        <TaskCommentsSection
          comments={comments}
          members={members}
          canMutate={canMutate}
          pending={pending}
          loading={loadingMeta}
          loadFailed={metaFailed}
          hasMore={hasMoreComments}
          loadingMore={loadingMoreComments}
          onLoadMore={() => void loadMoreComments()}
          onSubmit={submitComment}
          onDelete={(commentId) => void removeComment(commentId)}
        />

        <TaskActivitySection
          activities={activities}
          loading={loadingMeta}
          loadFailed={metaFailed}
        />
      </div>
    </section>
  );
}
