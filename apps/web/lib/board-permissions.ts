import { MemberRole } from '@kurultay/shared-types';

export function canCreateOrUpdateBoard(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN || role === MemberRole.MEMBER;
}

export function canDeleteBoard(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

export function canMutateColumns(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}
