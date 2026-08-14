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
} from '@kurultay/shared-types';
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

  const [loading, setLoading] = useState(needsDetail);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);

  // Held in a ref so the loading effect below does not re-run — and re-request — every time
  // the board hands the panel a new callback identity. Kept current from an effect rather than
  // assigned during render: a ref written while rendering is invisible to React's own
  // bookkeeping, and this file's lint rule says so.
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);

  // The task the detail read has already been attempted for. Without it a failed read would
  // retry on every render, because a failure leaves `checklists` null and `needsDetail` true.
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    if (taskId === null || !needsDetail || requestedRef.current === taskId) return;
    requestedRef.current = taskId;

    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);

    void (async () => {
      try {
        const detail = await api.get<TaskDto>(`/workspaces/${workspaceId}/tasks/${taskId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        onUpdatedRef.current(detail);
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [workspaceId, taskId, needsDetail]);

  // A different task means the previous one's verdict does not apply to it.
  useEffect(() => {
    if (requestedRef.current !== null && requestedRef.current !== taskId) {
      requestedRef.current = null;
      setLoadFailed(false);
    }
  }, [taskId]);

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
