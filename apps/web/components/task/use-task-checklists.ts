'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ChecklistDto,
  ChecklistSummaryDto,
  CreateChecklistItemRequest,
  CreateChecklistRequest,
  TaskDto,
  UpdateChecklistItemRequest,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';

export interface UseTaskChecklistsOptions {
  workspaceId: string;
  /** The task the panel is showing, or `null` while there is none. */
  task: TaskDto | null;
  canMutate: boolean;
  /** Same merge the rest of the panel writes through — one task list, one source. */
  onUpdated: (patch: Partial<TaskDto> & Pick<TaskDto, 'id'>) => void;
}

export interface UseTaskChecklistsResult {
  checklists: ChecklistDto[];
  /** The detail read is in flight; `checklists` is a placeholder, not an answer. */
  loading: boolean;
  loadFailed: boolean;
  /** A write is in flight. */
  pending: boolean;
  addChecklist: (title: string) => Promise<boolean>;
  removeChecklist: (checklistId: string) => Promise<void>;
  addItem: (checklistId: string, content: string) => Promise<boolean>;
  toggleItem: (itemId: string, isDone: boolean) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

function summarize(checklists: ChecklistDto[]): ChecklistSummaryDto {
  let total = 0;
  let done = 0;
  for (const list of checklists) {
    for (const item of list.items) {
      total += 1;
      if (item.isDone) done += 1;
    }
  }
  return { total, done };
}

/**
 * The panel's checklist reads and writes.
 *
 * Two things make this more than a set of `api.*` calls.
 *
 * The first is that a task opened from the board arrives with `checklists: null` — the board's
 * list query carries only the summary, on purpose (ADR 0023 K3), so the panel is the thing
 * that has to go and read the items. `null` means "not loaded"; a task with no checklist reads
 * back `[]`. Conflating them is how a panel ends up announcing "no checklists" about a task
 * that has three.
 *
 * The second is the tick. Every checklist endpoint answers with the whole `TaskDto`, so the
 * simple version is await-then-render — and a checkbox that waits for a round trip before it
 * moves feels broken. So the toggle is applied locally first, with the summary recounted in
 * the same patch (the board card's badge reads `checklistSummary`, and a stale one shows 1/2
 * next to two ticks), and the previous state is put back if the server refuses.
 */
export function useTaskChecklists({
  workspaceId,
  task,
  canMutate,
  onUpdated,
}: UseTaskChecklistsOptions): UseTaskChecklistsResult {
  const t = useTranslations('app.board.task.checklist');
  const taskId = task?.id ?? null;
  const needsDetail = task !== null && task.checklists === null;

  const [pending, setPending] = useState(false);

  /**
   * The task whose read failed, rather than a bare "it failed".
   *
   * Keyed by id so switching tasks clears the verdict by arithmetic instead of by an effect
   * that has to remember to. A boolean here needed a second effect to reset it, and that reset
   * is exactly the kind of cascading `setState` in an effect body React now warns about.
   */
  const [failedTaskId, setFailedTaskId] = useState<string | null>(null);
  const loadFailed = failedTaskId !== null && failedTaskId === taskId;

  // Derived, not stored. "Loading" is precisely "the panel needs the detail and has not been
  // told it cannot have it" — and a stored copy of that is a second source of truth that can
  // disagree with the task prop for a frame, which is the flash this hook exists to avoid.
  const loading = needsDetail && !loadFailed;

  // Held in a ref so the loading effect below does not re-run — and re-request — every time
  // the board hands the panel a new callback identity. Kept current from an effect rather than
  // assigned during render: a ref written while rendering is invisible to React's own
  // bookkeeping, and this file's lint rule says so.
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);

  // No "already asked for this task" guard here, on purpose, and it took a mutation test to
  // establish that one would be wrong in both directions.
  //
  // It would be wrong to keep: the board's list query answers with `checklists: null`, so a
  // filter change re-running it puts a summary-only row back under an open panel. A guard that
  // refused a second read would leave that panel rendering the empty state for a task whose
  // checklists it had just shown — "not loaded" mistaken for "none", arrived at from the far
  // side.
  //
  // And it is not needed to stop a failed read looping: this effect re-runs only when one of
  // its three dependencies changes, and a failure changes none of them. What that costs is a
  // failure the reader cannot retry without switching tasks and back, which is the same deal
  // the comment and activity sections make with `metaFailed`.
  useEffect(() => {
    if (taskId === null || !needsDetail) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const detail = await api.get<TaskDto>(`/workspaces/${workspaceId}/tasks/${taskId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        // Clears an earlier verdict on this same task — the read the reader came back for.
        setFailedTaskId(null);
        onUpdatedRef.current(detail);
      } catch {
        if (controller.signal.aborted) return;
        setFailedTaskId(taskId);
      }
    })();

    return () => controller.abort();
  }, [workspaceId, taskId, needsDetail]);

  const write = useCallback(
    async (run: () => Promise<TaskDto>): Promise<boolean> => {
      setPending(true);
      try {
        onUpdatedRef.current(await run());
        return true;
      } catch (caught) {
        toast.error(
          resolveApiMessage(caught, t, { fallback: 'saveError', byStatus: { 403: 'forbidden' } }),
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [t],
  );

  const addChecklist = useCallback(
    async (title: string): Promise<boolean> => {
      if (!canMutate || taskId === null) return false;
      return write(() =>
        api.post<TaskDto, CreateChecklistRequest>(
          `/workspaces/${workspaceId}/tasks/${taskId}/checklists`,
          { title },
        ),
      );
    },
    [canMutate, taskId, workspaceId, write],
  );

  const removeChecklist = useCallback(
    async (checklistId: string): Promise<void> => {
      if (!canMutate || taskId === null) return;
      await write(() =>
        api.delete<TaskDto>(`/workspaces/${workspaceId}/tasks/${taskId}/checklists/${checklistId}`),
      );
    },
    [canMutate, taskId, workspaceId, write],
  );

  const addItem = useCallback(
    async (checklistId: string, content: string): Promise<boolean> => {
      if (!canMutate || taskId === null) return false;
      return write(() =>
        api.post<TaskDto, CreateChecklistItemRequest>(
          `/workspaces/${workspaceId}/tasks/${taskId}/checklists/${checklistId}/items`,
          { content },
        ),
      );
    },
    [canMutate, taskId, workspaceId, write],
  );

  const removeItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (!canMutate || taskId === null) return;
      await write(() =>
        api.delete<TaskDto>(`/workspaces/${workspaceId}/tasks/${taskId}/checklist-items/${itemId}`),
      );
    },
    [canMutate, taskId, workspaceId, write],
  );

  const toggleItem = useCallback(
    async (itemId: string, isDone: boolean): Promise<void> => {
      if (!canMutate || task === null) return;

      const previous = task.checklists;
      const previousSummary = task.checklistSummary;
      if (previous !== null) {
        const next = previous.map((list) => ({
          ...list,
          items: list.items.map((item) => (item.id === itemId ? { ...item, isDone } : item)),
        }));
        onUpdatedRef.current({
          id: task.id,
          checklists: next,
          checklistSummary: summarize(next),
        });
      }

      setPending(true);
      try {
        const updated = await api.patch<TaskDto, UpdateChecklistItemRequest>(
          `/workspaces/${workspaceId}/tasks/${task.id}/checklist-items/${itemId}`,
          { isDone },
        );
        onUpdatedRef.current(updated);
      } catch (caught) {
        onUpdatedRef.current({
          id: task.id,
          checklists: previous,
          checklistSummary: previousSummary,
        });
        toast.error(
          resolveApiMessage(caught, t, { fallback: 'saveError', byStatus: { 403: 'forbidden' } }),
        );
      } finally {
        setPending(false);
      }
    },
    [canMutate, task, workspaceId, t],
  );

  return {
    checklists: task?.checklists ?? [],
    loading,
    loadFailed,
    pending,
    addChecklist,
    removeChecklist,
    addItem,
    toggleItem,
    removeItem,
  };
}
