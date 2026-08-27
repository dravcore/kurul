'use client';

import { useMemo } from 'react';
import type { WorkspacePlanDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';

/**
 * What no ceiling looks like: the value every screen holds until the server answers, and the
 * value it keeps if the answer never comes.
 *
 * **Failing open is the decision.** A plan read that fails must not disable a control the
 * workspace is entitled to use: the API refuses an over-limit write on its own, with a message
 * naming the ceiling, so the worst case of an optimistic client is one refused request. The
 * opposite default would turn a hiccup on a read nobody asked for into a workspace that cannot
 * create a board and is told nothing about why.
 */
const NO_CEILINGS: WorkspacePlanDto = {
  limits: { seats: null, boards: null, storageBytes: null },
  usage: { seats: 0, boards: 0, storageBytes: 0 },
};

/**
 * The plan of the active workspace, as a hook with no error surface of its own.
 *
 * Its own resource rather than a field folded into the roster or the board list: this is the
 * only value on those screens whose failure has no consequence worth reporting (see
 * `NO_CEILINGS`), and giving it the same error path as the list would let a plan read take a
 * working screen down with it.
 */
export function useWorkspacePlan(workspaceId: string | null): WorkspacePlanDto {
  const fetcher = useMemo(
    () =>
      workspaceId
        ? (signal: AbortSignal): Promise<WorkspacePlanDto> =>
            api.get<WorkspacePlanDto>(`/workspaces/${workspaceId}/plan`, { signal })
        : null,
    [workspaceId],
  );

  // `null` as the message: nothing renders it, and inventing one would put a string in both
  // catalogues that no screen ever displays.
  const { data } = useApiResource<WorkspacePlanDto>(fetcher, NO_CEILINGS, null);
  return data;
}

/** Whether a ceiling is set and already reached. A `null` ceiling is never reached. */
export function isAtCeiling(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}
