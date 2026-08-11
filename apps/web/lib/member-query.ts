import type { CursorPage, WorkspaceMemberDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';

/**
 * Largest page the API will serve: `MAX_PAGE_LIMIT` in
 * `apps/api/src/common/pagination/page-limit.ts` clamps `?limit=` to 100, so asking for more
 * only wastes the round-trip it was supposed to save.
 */
export const WORKSPACE_MEMBER_PAGE_LIMIT = 100;

/**
 * Every member of the workspace, drained across cursor pages.
 *
 * The roster feeds pickers that filter locally — the assignee filter, the assignee
 * checkboxes, the `@mention` list — and a locally filtered list is only honest if the client
 * holds all of it. Stopping at the first page would put the truncation the server just gave
 * up back into the client, one layer further from anyone who could notice it.
 *
 * Every ordinary workspace fits in a single request; the loop only costs a round trip per
 * extra hundred members, and pages cannot be fetched in parallel because the cursor is only
 * known once the previous page returns.
 */
export async function fetchAllWorkspaceMembers(
  workspaceId: string,
  init?: RequestInit,
): Promise<WorkspaceMemberDto[]> {
  const members: WorkspaceMemberDto[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams({ limit: String(WORKSPACE_MEMBER_PAGE_LIMIT) });
    if (cursor) params.set('cursor', cursor);

    const page = await api.get<CursorPage<WorkspaceMemberDto>>(
      `/workspaces/${workspaceId}/members?${params.toString()}`,
      init,
    );
    if (init?.signal?.aborted) break;

    members.push(...page.items);
    // A cursor that does not advance would loop forever, so it ends the drain instead.
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break;

    cursor = page.nextCursor;
  }

  return members;
}

/** The signed-in user's own membership — one row, instead of scanning the whole roster. */
export function fetchOwnMembership(
  workspaceId: string,
  init?: RequestInit,
): Promise<WorkspaceMemberDto> {
  return api.get<WorkspaceMemberDto>(`/workspaces/${workspaceId}/members/me`, init);
}
