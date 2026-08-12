/**
 * Process-wide hook so Better Auth organization lifecycle callbacks can kick a user out of
 * Socket.io rooms without importing Nest DI into `auth.ts` / `organization-options.ts`.
 *
 * `RealtimeService.attachServer` registers the real implementation; until then (and in unit
 * tests that never boot the gateway) eviction is a no-op.
 */
type EvictFn = (workspaceId: string, userId: string) => Promise<void>;

let evictFn: EvictFn | null = null;

export function registerWorkspaceSocketEviction(fn: EvictFn): void {
  evictFn = fn;
}

export async function evictUserFromWorkspaceSockets(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await evictFn?.(workspaceId, userId);
}
