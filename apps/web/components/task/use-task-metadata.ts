'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ActivityDto,
  CommentDto,
  CursorPage,
  LabelDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import { api } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';
import { useApiResource, useResourceField } from '@/lib/use-api-resource';

export type UseTaskMetadataOptions = {
  workspaceId: string;
  boardId: string;
  /** `null` while the panel has no task yet: nothing is read until one arrives. */
  taskId: string | null;
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
  /**
   * The load failed, so `comments` and `activities` are the empty fallback rather than an
   * answer. The sections that render them say so instead of showing their empty message —
   * `[]` on its own cannot tell "nothing here" from "nothing read".
   */
  metaFailed: boolean;
};

/** The four lists the panel loads together, held as one resource because they are one fetch. */
type TaskMeta = {
  members: WorkspaceMemberDto[];
  boardLabels: LabelDto[];
  comments: CommentDto[];
  /** `null` once the thread is fully drained. */
  commentsCursor: string | null;
  activities: ActivityDto[];
};

const COMMENTS_PAGE_LIMIT = 100;
/** Activity is capped at the newest page on purpose; the panel has no "older activity" view. */
const ACTIVITIES_PAGE_LIMIT = 50;

/**
 * Everything the task panel shows besides the task row itself. One aborted-on-unmount fetch
 * covers all four lists, so opening a card is a single round of requests rather than one per
 * section.
 *
 * The abort/race handling is `useApiResource`'s, not this hook's — the four lists are one `T`
 * precisely so they stay one abort, one loading flag and one failure. `metaRefreshKey` and the
 * shared board caches sit in the fetcher's identity because that is what the hook watches to
 * decide a reload is due.
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

  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  const loadMeta = useCallback(
    async (signal: AbortSignal): Promise<TaskMeta> => {
      const sharedReady = membersProp !== undefined && labelsProp !== undefined;
      const [members, boardLabels, comments, activities] = await Promise.all([
        sharedReady
          ? Promise.resolve(membersProp)
          : fetchAllWorkspaceMembers(workspaceId, { signal }),
        sharedReady
          ? Promise.resolve(labelsProp)
          : api.get<LabelDto[]>(`/workspaces/${workspaceId}/boards/${boardId}/labels`, { signal }),
        api.get<CursorPage<CommentDto>>(
          `/workspaces/${workspaceId}/tasks/${taskId}/comments?limit=${COMMENTS_PAGE_LIMIT}`,
          { signal },
        ),
        api.get<CursorPage<ActivityDto>>(
          `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=${ACTIVITIES_PAGE_LIMIT}`,
          { signal },
        ),
      ]);
      return {
        members,
        boardLabels,
        comments: comments.items,
        commentsCursor: comments.nextCursor,
        activities: activities.items,
      };
    },
    // `metaRefreshKey` is not read by the loader — it is a dependency because the hook
    // reloads when the fetcher's identity changes, which is how a bump becomes a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, boardId, taskId, metaRefreshKey, membersProp, labelsProp],
  );

  const {
    data: meta,
    loading: loadingMeta,
    failed: metaFailed,
    setData: setMeta,
  } = useApiResource<TaskMeta>(
    // `null` holds the read off entirely, which is the state a deep-linked panel is in before
    // the board has fetched the task. `loadMeta` therefore only ever runs with a real id.
    taskId === null ? null : loadMeta,
    // On a deep link the panel mounts before the board resolves, so `membersProp` and
    // `labelsProp` can still be empty here. Because this is only read on the first render,
    // that empty snapshot is what the assignee picker and label list are stuck with for the
    // rest of this resource's life, even after the board's own fetch fills them in.
    {
      members: membersProp ?? [],
      boardLabels: labelsProp ?? [],
      comments: [],
      commentsCursor: null,
      activities: [],
    },
    // No message: the comment and activity sections each report the failure in place, because
    // one sentence cannot say what two emptied lists now mean — and a toast that fades leaves
    // them reading as "no comments" and "no activity", the wrong answer and the one that stays
    // on screen. `failed` below is the whole of what this caller needs.
    null,
  );

  const setBoardLabels = useResourceField(setMeta, 'boardLabels');
  const setComments = useResourceField(setMeta, 'comments');

  /** Comments come back oldest first, so the next page appends to the end of the thread. */
  const loadMoreComments = useCallback(
    async function run(): Promise<void> {
      const cursor = meta.commentsCursor;
      if (!cursor || loadingMoreComments) return;
      setLoadingMoreComments(true);
      try {
        const page = await api.get<CursorPage<CommentDto>>(
          `/workspaces/${workspaceId}/tasks/${taskId}/comments?limit=${COMMENTS_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`,
        );
        setMeta((current) => {
          // A comment posted from this panel also sits past the cursor, so the next page can
          // repeat what is already on screen — the id is what decides, not the server slice.
          const seen = new Set(current.comments.map((comment) => comment.id));
          return {
            ...current,
            comments: [...current.comments, ...page.items.filter((item) => !seen.has(item.id))],
            commentsCursor: page.nextCursor,
          };
        });
      } catch {
        toast.error(t('commentsLoadMoreError'), {
          action: { label: t('retryAction'), onClick: () => void run() },
        });
      } finally {
        setLoadingMoreComments(false);
      }
    },
    [workspaceId, taskId, meta.commentsCursor, loadingMoreComments, setMeta, t],
  );

  const refreshActivities = useCallback(
    async function run(): Promise<void> {
      try {
        const page = await api.get<CursorPage<ActivityDto>>(
          `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=${ACTIVITIES_PAGE_LIMIT}`,
        );
        setMeta((current) => ({ ...current, activities: page.items }));
      } catch {
        toast.error(tActivity('loadError'), {
          action: { label: t('retryAction'), onClick: () => void run() },
        });
      }
    },
    [workspaceId, taskId, setMeta, tActivity, t],
  );

  return {
    members: meta.members,
    boardLabels: meta.boardLabels,
    setBoardLabels,
    comments: meta.comments,
    setComments,
    hasMoreComments: meta.commentsCursor !== null,
    loadingMoreComments,
    loadMoreComments,
    activities: meta.activities,
    refreshActivities,
    loadingMeta,
    metaFailed,
  };
}
