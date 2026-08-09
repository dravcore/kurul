import type { BoardDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';

/** In-flight dedupe so DashboardSummary + BoardList share one boards GET. */
const inflight = new Map<string, Promise<BoardDto[]>>();

export function fetchWorkspaceBoards(workspaceId: string, init?: RequestInit): Promise<BoardDto[]> {
  const existing = inflight.get(workspaceId);
  if (existing) return existing;

  const request = api.get<BoardDto[]>(`/workspaces/${workspaceId}/boards`, init).finally(() => {
    // Clear after microtask so concurrent mounts share; later mounts refetch.
    queueMicrotask(() => {
      if (inflight.get(workspaceId) === request) {
        inflight.delete(workspaceId);
      }
    });
  });

  inflight.set(workspaceId, request);
  return request;
}
