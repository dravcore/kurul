'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ActivityDto,
  CommentDto,
  CursorPage,
  LabelDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';

export type UseTaskMetadataOptions = {
  workspaceId: string;
  boardId: string;
  taskId: string;
  /** Board-scoped caches from BoardView — skip the members/labels refetch when provided. */
  members?: WorkspaceMemberDto[];
  labels?: LabelDto[];
  /** Bump to refetch comments and activity without remounting. */
  metaRefreshKey?: number;
};

export type UseTaskMetadataResult = {
  members: WorkspaceMemberDto[];
  boardLabels: LabelDto[];
  setBoardLabels: Dispatch<SetStateAction<LabelDto[]>>;
  comments: CommentDto[];
  setComments: Dispatch<SetStateAction<CommentDto[]>>;
  /** A page of comments is left on the server — the thread shown is not the whole thread. */
  hasMoreComments: boolean;
  loadingMoreComments: boolean;
  loadMoreComments: () => Promise<void>;
  activities: ActivityDto[];
  refreshActivities: () => Promise<void>;
  loadingMeta: boolean;
};

const COMMENTS_PAGE_LIMIT = 100;
/** Activity is capped at the newest page on purpose; the panel has no "older activity" view. */
const ACTIVITIES_PAGE_LIMIT = 50;

/**
 * Everything the task panel shows besides the task row itself. One aborted-on-unmount fetch
 * covers all four lists, so opening a card is a single round of requests rather than one per
 * section.
 */
export function useTaskMetadata({
  workspaceId,
  boardId,
  taskId,
  members: membersProp,
  labels: labelsProp,
  metaRefreshKey = 0,
}: UseTaskMetadataOptions): UseTaskMetadataResult {
  const t = useTranslations('app.board.task');
  const tActivity = useTranslations('app.board.task.activity');

  const [members, setMembers] = useState<WorkspaceMemberDto[]>(membersProp ?? []);
  const [boardLabels, setBoardLabels] = useState<LabelDto[]>(labelsProp ?? []);
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [activities, setActivities] = useState<ActivityDto[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    if (membersProp) setMembers(membersProp);
  }, [membersProp]);

  useEffect(() => {
    if (labelsProp) setBoardLabels(labelsProp);
  }, [labelsProp]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingMeta(true);
    void (async () => {
      try {
        const sharedReady = membersProp !== undefined && labelsProp !== undefined;
        const [nextMembers, nextLabels, nextComments, nextActivities] = await Promise.all([
          sharedReady
            ? Promise.resolve(membersProp)
            : fetchAllWorkspaceMembers(workspaceId, { signal: controller.signal }),
          sharedReady
            ? Promise.resolve(labelsProp)
            : api.get<LabelDto[]>(`/workspaces/${workspaceId}/boards/${boardId}/labels`, {
                signal: controller.signal,
              }),
          api.get<CursorPage<CommentDto>>(
            `/workspaces/${workspaceId}/tasks/${taskId}/comments?limit=${COMMENTS_PAGE_LIMIT}`,
            { signal: controller.signal },
          ),
          api.get<CursorPage<ActivityDto>>(
            `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=${ACTIVITIES_PAGE_LIMIT}`,
            { signal: controller.signal },
          ),
        ]);
        if (!controller.signal.aborted) {
          if (!sharedReady) {
            setMembers(nextMembers);
            setBoardLabels(nextLabels);
          }
          setComments(nextComments.items);
          setCommentsCursor(nextComments.nextCursor);
          setActivities(nextActivities.items);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCommentsCursor(null);
          toast.error(t('metaLoadError'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingMeta(false);
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceId, boardId, taskId, metaRefreshKey, membersProp, labelsProp, t]);

  /** Comments come back oldest first, so the next page appends to the end of the thread. */
  const loadMoreComments = useCallback(async (): Promise<void> => {
    if (!commentsCursor || loadingMoreComments) return;
    setLoadingMoreComments(true);
    try {
      const page = await api.get<CursorPage<CommentDto>>(
        `/workspaces/${workspaceId}/tasks/${taskId}/comments?limit=${COMMENTS_PAGE_LIMIT}&cursor=${encodeURIComponent(commentsCursor)}`,
      );
      setComments((current) => {
        // A comment posted from this panel also sits past the cursor, so the next page can
        // repeat what is already on screen — the id is what decides, not the server slice.
        const seen = new Set(current.map((comment) => comment.id));
        return [...current, ...page.items.filter((comment) => !seen.has(comment.id))];
      });
      setCommentsCursor(page.nextCursor);
    } catch {
      toast.error(t('commentsLoadMoreError'));
    } finally {
      setLoadingMoreComments(false);
    }
  }, [workspaceId, taskId, commentsCursor, loadingMoreComments, t]);

  const refreshActivities = useCallback(async (): Promise<void> => {
    try {
      const page = await api.get<CursorPage<ActivityDto>>(
        `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=${ACTIVITIES_PAGE_LIMIT}`,
      );
      setActivities(page.items);
    } catch {
      toast.error(tActivity('loadError'));
    }
  }, [workspaceId, taskId, tActivity]);

  return {
    members,
    boardLabels,
    setBoardLabels,
    comments,
    setComments,
    hasMoreComments: commentsCursor !== null,
    loadingMoreComments,
    loadMoreComments,
    activities,
    refreshActivities,
    loadingMeta,
  };
}
