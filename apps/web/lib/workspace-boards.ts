import type { BoardDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';

/** In-flight dedupe so DashboardSummary + BoardList share one boards GET. */
const inflight = new Map<string, Promise<BoardDto[]>>();

/**
 * Loads a workspace's boards, sharing one request between everything that asks at once.
 *
 * Deliberately takes no `AbortSignal`. A promise handed to several subscribers cannot have
 * its lifetime owned by whichever one happened to ask first: aborting on that subscriber's
 * unmount rejects the shared promise for every other subscriber too, and they see a plain
 * failure rather than their own cancellation. That is exactly what React StrictMode's
 * mount→cleanup→mount produced in dev — the first mount's cleanup aborted the request, and
 * because the entry is cleared a microtask later, the second mount and the sibling list both
 * joined the already-aborted promise and rendered "Your boards couldn't load."
 *
 * Unmount safety does not depend on the abort: `useApiResource` guards every `setState` with
 * its own controller's `aborted`, so an unmounted subscriber writes nothing either way. The
 * price is that in the rare no-subscribers-left case one small GET finishes in the
 * background, which is cheaper than the bug it removes.
 */
export function fetchWorkspaceBoards(workspaceId: string): Promise<BoardDto[]> {
  const existing = inflight.get(workspaceId);
  if (existing) return existing;

  const request = api.get<BoardDto[]>(`/workspaces/${workspaceId}/boards`).finally(() => {
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
