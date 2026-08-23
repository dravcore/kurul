'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurul/shared-types';
import { api, apiStatus } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';

export type UseBoardPanelTaskOptions = {
  selectedTaskId: string | null;
  tasks: TaskDto[];
  /** The board's own load. Nothing is fetched for the panel while the board is still arriving. */
  loading: boolean;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
};

export type UseBoardPanelTaskResult = {
  /** The deep-linked task has not arrived yet — neither on the board nor from its own fetch. */
  panelLoading: boolean;
  /** A retryable failure to read the deep-linked task. `null` when it is simply not there. */
  panelError: string | null;
  retryPanelTask: () => void;
};

/**
 * The one read the board makes on the panel's behalf: a deep-linked task the board never
 * loaded — filtered out, or on a page still draining.
 *
 * The row is folded into `tasks` rather than held here, so the board and the panel keep
 * rendering from one list. That is also why this is the only fetcher in the board layer that
 * *is* a `useApiResource`: it is genuinely one value arriving once, which is the shape that
 * hook models.
 */
export function useBoardPanelTask({
  selectedTaskId,
  tasks,
  loading,
  setTasks,
}: UseBoardPanelTaskOptions): UseBoardPanelTaskResult {
  const tErrors = useTranslations('app.errors');
  const { activeId } = useWorkspaceContext();

  // Read from `tasks` rather than a ref: a ref is invisible to rendering, so the memo below
  // could not see the row arriving and went on handing back a fetcher for a task that was
  // already on the board. Reduced to a boolean first so the memo's identity — which is what
  // decides whether `useApiResource` refetches — does not change with every task page that
  // drains in.
  const hasSelectedTask =
    selectedTaskId !== null && tasks.some((task) => task.id === selectedTaskId);

  const fetchSelectedTask = useMemo(() => {
    if (!activeId || !selectedTaskId || loading || hasSelectedTask) return null;
    return (signal: AbortSignal): Promise<TaskDto> =>
      api.get<TaskDto>(`/workspaces/${activeId}/tasks/${selectedTaskId}`, { signal });
  }, [activeId, selectedTaskId, loading, hasSelectedTask]);

  /**
   * Whether the last failure was the server saying the row is not there.
   *
   * `useApiResource` reports one message per failure, but the panel has to tell a task that is
   * gone (nothing to retry) from a load that broke (worth another go), and only the caught
   * error knows which. Never read while `fetchedTaskError` is `null`, so it does not need
   * clearing on success — the two are written in the same pass.
   */
  const [selectedTaskGone, setSelectedTaskGone] = useState(false);

  // The fetched row is not read back off the resource — `onSuccess` folds it straight into
  // `tasks`, which is the one list the board and the panel both render from.
  const { error: fetchedTaskError, reload: retryPanelTask } = useApiResource<TaskDto | null>(
    fetchSelectedTask,
    null,
    tErrors('taskLoad'),
    {
      onError: (caught) => setSelectedTaskGone(apiStatus(caught) === 404),
      // Folded in as the row arrives rather than from an effect watching the resolved value.
      // The effect version needed a second render to do the merge, and `panelLoading` is keyed
      // on the row being *in* `tasks` — so the frame in between was one where the fetch had
      // succeeded and the panel still said the task was on its way.
      onSuccess: (task) => {
        if (!task) return;
        setTasks((current) =>
          current.some((item) => item.id === task.id) ? current : [...current, task],
        );
      },
    },
  );

  // No request in flight means no failure to report — a task that is already on the board
  // must not inherit the error left over from the last one that was not.
  const panelError = fetchSelectedTask && !selectedTaskGone ? fetchedTaskError : null;

  /**
   * Still on its way. Keyed on the row reaching `tasks` rather than on the hook's own
   * `loading`, so that "arrived" means the same thing here as it does to the panel rendering
   * from `tasks` — one source, not two flags that can disagree for a frame.
   */
  const panelLoading = fetchSelectedTask !== null && fetchedTaskError === null && !hasSelectedTask;

  return { panelLoading, panelError, retryPanelTask };
}
