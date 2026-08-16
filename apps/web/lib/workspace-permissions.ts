import { MemberRole } from '@kurul/shared-types';

/**
 * Who may rename the workspace.
 *
 * Mirrors `ADMIN_ROLES` on `WorkspaceController#update`'s `@WorkspaceRoles` decorator
 * (apps/api/src/workspace/workspace.controller.ts). Kept as its own predicate rather than
 * reusing `canManageMembers` from `member-permissions.ts`, even though the two answer to the
 * same `[OWNER, ADMIN]` set today: that module is deliberately about who belongs to the
 * workspace, and this one is about what the workspace itself is called. Sharing a predicate
 * across two questions that only coincide by accident is how a future split of `ADMIN_ROLES`
 * (e.g. member management staying ADMIN-gated while workspace identity moves to OWNER-only)
 * quietly changes the wrong screen.
 */
export function canRenameWorkspace(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

/**
 * Who may delete the workspace outright.
 *
 * `WorkspaceController#remove` gates this at `@WorkspaceRoles(MemberRole.OWNER)` — stricter
 * than rename, and unlike `removeMember` and `WorkspaceMemberService.leave` it carries no
 * "last owner" exception to reason about: those refuse to strip the workspace of its only
 * owner because a workspace with nobody in charge of it still exists, but deleting it removes
 * the thing ownership would apply to. There is nothing left to guard.
 */
export function canDeleteWorkspace(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER;
}
