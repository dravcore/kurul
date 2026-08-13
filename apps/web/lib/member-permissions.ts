import { MemberRole } from '@kurultay/shared-types';

/**
 * Who may invite, revoke an invitation, change a role, and remove a member.
 *
 * Mirrors `ADMIN_ROLES` on the `@WorkspaceRoles` decorators in
 * `apps/api/src/workspace/workspace.controller.ts`. The server is what *enforces* this; these
 * predicates only decide whether a control is drawn at all. That distinction is the point —
 * `docs/design.md` §7 asks every error to end with a way out, and "you were never allowed to
 * press this" is not a way out, so a control the caller can only ever be refused is not shown.
 *
 * Kept apart from `board-permissions.ts` deliberately: that module is about content inside a
 * workspace, this one is about who belongs to it, and the two answer to different endpoints.
 */
export function canManageMembers(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

/**
 * Who may hand out or take away OWNER.
 *
 * `WorkspaceMemberService.updateMemberRole` refuses an ADMIN in both directions with a single
 * message ("Only an OWNER can change ownership"), and `removeMember` refuses the same ADMIN
 * aiming at an OWNER. One predicate covers all three, so the UI cannot end up hiding the
 * promotion while still offering the removal.
 */
export function canChangeOwnership(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER;
}

/**
 * Whether `actorRole` may act on a membership currently held at `targetRole`.
 *
 * Only an OWNER may touch another OWNER. An ADMIN keeps every control on everyone else.
 */
export function canManageMember(actorRole: MemberRole | null, targetRole: MemberRole): boolean {
  if (!canManageMembers(actorRole)) return false;
  return targetRole !== MemberRole.OWNER || canChangeOwnership(actorRole);
}

/**
 * Roles an invitation may be sent at, most access first.
 *
 * OWNER is absent because `CreateInvitationDto` rejects it outright (`@IsNotIn`): ownership is
 * transferred to someone who has already joined, never mailed to an address that has not
 * accepted anything yet.
 */
export const INVITABLE_ROLES = [
  MemberRole.ADMIN,
  MemberRole.MEMBER,
  MemberRole.GUEST,
] as const satisfies readonly MemberRole[];

/**
 * Roles an existing membership may be moved to, from `actorRole`'s point of view.
 *
 * OWNER is offered only to an OWNER, because promoting someone to it is how ownership is
 * handed over and an ADMIN attempting it gets a `403`. Offering an option that is always
 * refused would make the picker teach the wrong rule.
 */
export function assignableRoles(actorRole: MemberRole | null): readonly MemberRole[] {
  return canChangeOwnership(actorRole) ? [MemberRole.OWNER, ...INVITABLE_ROLES] : INVITABLE_ROLES;
}
