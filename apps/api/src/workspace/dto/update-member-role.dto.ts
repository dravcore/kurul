import { MemberRole } from '@kurul/shared-types';
import { IsEnum } from 'class-validator';

/**
 * Body of `PATCH /workspaces/:workspaceId/members/:userId/role`.
 *
 * Unlike `CreateInvitationDto`, `OWNER` is *not* excluded here: promotion to OWNER is a real
 * operation (it is how ownership is handed over before the outgoing owner leaves). Who may
 * perform it is a role-hierarchy question, not a shape question, so it is answered in
 * `WorkspaceMemberService` where the caller's own role is known — a DTO cannot see it.
 */
export class UpdateMemberRoleDto {
  @IsEnum(MemberRole)
  role!: MemberRole;
}
