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
  activities: ActivityDto[];
  refreshActivities: () => Promise<void>;
  loadingMeta: boolean;
};

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
            : api.get<WorkspaceMemberDto[]>(`/workspaces/${workspaceId}/members`, {
                signal: controller.signal,
              }),
          sharedReady
            ? Promise.resolve(labelsProp)
            : api.get<LabelDto[]>(`/workspaces/${workspaceId}/boards/${boardId}/labels`, {
                signal: controller.signal,
              }),
          api.get<CursorPage<CommentDto>>(
            `/workspaces/${workspaceId}/tasks/${taskId}/comments?limit=100`,
            { signal: controller.signal },
          ),
          api.get<CursorPage<ActivityDto>>(
            `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=50`,
            { signal: controller.signal },
          ),
        ]);
        if (!controller.signal.aborted) {
          if (!sharedReady) {
            setMembers(nextMembers);
            setBoardLabels(nextLabels);
          }
          setComments(nextComments.items);
          setActivities(nextActivities.items);
        }
      } catch {
        if (!controller.signal.aborted) {
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

  const refreshActivities = useCallback(async (): Promise<void> => {
    try {
      const page = await api.get<CursorPage<ActivityDto>>(
        `/workspaces/${workspaceId}/tasks/${taskId}/activities?limit=50`,
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
    activities,
    refreshActivities,
    loadingMeta,
  };
}
