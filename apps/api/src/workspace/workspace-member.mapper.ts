import { MemberRole } from '@kurultay/shared-types';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';

/** The membership row shape every member read maps from. */
export type MemberRow = {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  user: { name: string; avatarUrl: string | null };
};

/** Name and avatar live on the user, so every member read joins the same two columns. */
export const memberInclude = { user: { select: { name: true, avatarUrl: true } } } as const;

export function toMemberDto(row: MemberRow): WorkspaceMemberDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as MemberRole,
    name: row.user.name,
    avatarUrl: row.user.avatarUrl,
  };
}
