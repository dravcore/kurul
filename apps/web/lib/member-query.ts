import type { CursorPage, InvitationDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { api } from '@/lib/api';

/**
 * Largest page the API will serve: `MAX_PAGE_LIMIT` in
 * `apps/api/src/common/pagination/page-limit.ts` clamps `?limit=` to 100, so asking for more
 * only wastes the round-trip it was supposed to save.
 */
export const WORKSPACE_MEMBER_PAGE_LIMIT = 100;

/**
 * The invitation queue is clamped by the same `MAX_PAGE_LIMIT`. Named separately from the
 * roster's constant rather than shared: they are two endpoints that happen to agree today, and
 * a future ceiling change on one of them should not silently retune the other.
 */
export const WORKSPACE_INVITATION_PAGE_LIMIT = 100;

/**
 * Walks a cursor-paged collection to its end and returns every row.
 *
 * The two callers below both need the *whole* list rather than a page — a locally filtered
 * picker and a queue an admin revokes from are only honest if the client holds all of it — and
 * the walk has three details that are easy to get subtly wrong in each copy: the abort check
 * between pages, `hasMore` being authoritative over a stray `nextCursor`, and the guard against
 * a cursor that does not advance (which would otherwise loop forever against a server bug).
 *
 * Pages cannot be fetched in parallel: the next cursor is only known once the previous page
 * returns.
 */
async function drainCursorPages<T>(path: string, limit: number, init?: RequestInit): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);

    const page = await api.get<CursorPage<T>>(`${path}?${params.toString()}`, init);
    if (init?.signal?.aborted) break;

    rows.push(...page.items);
    // A cursor that does not advance would loop forever, so it ends the drain instead.
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break;

    cursor = page.nextCursor;
  }

  return rows;
}

/**
 * Every member of the workspace, drained across cursor pages.
 *
 * The roster feeds pickers that filter locally — the assignee filter, the assignee
 * checkboxes, the `@mention` list — and a locally filtered list is only honest if the client
 * holds all of it. Stopping at the first page would put the truncation the server just gave
 * up back into the client, one layer further from anyone who could notice it.
 *
 * Every ordinary workspace fits in a single request; the loop only costs a round trip per
 * extra hundred members.
 */
export function fetchAllWorkspaceMembers(
  workspaceId: string,
  init?: RequestInit,
): Promise<WorkspaceMemberDto[]> {
  return drainCursorPages<WorkspaceMemberDto>(
    `/workspaces/${workspaceId}/members`,
    WORKSPACE_MEMBER_PAGE_LIMIT,
    init,
  );
}

/**
 * Every invitation still waiting for an answer, drained the same way.
 *
 * **OWNER / ADMIN only.** The endpoint answers `403` for anyone else (an invited address
 * belongs to someone who has agreed to nothing yet), so a caller has to decide from the
 * signed-in user's own role whether to ask at all — see `canManageMembers` in
 * `lib/member-permissions.ts`. Asking anyway would turn a permission the user simply does not
 * have into a failed load on a screen that is otherwise working.
 */
export function fetchPendingInvitations(
  workspaceId: string,
  init?: RequestInit,
): Promise<InvitationDto[]> {
  return drainCursorPages<InvitationDto>(
    `/workspaces/${workspaceId}/invitations`,
    WORKSPACE_INVITATION_PAGE_LIMIT,
    init,
  );
}

/** The signed-in user's own membership — one row, instead of scanning the whole roster. */
export function fetchOwnMembership(
  workspaceId: string,
  init?: RequestInit,
): Promise<WorkspaceMemberDto> {
  return api.get<WorkspaceMemberDto>(`/workspaces/${workspaceId}/members/me`, init);
}
