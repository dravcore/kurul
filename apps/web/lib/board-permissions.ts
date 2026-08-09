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

/** ADR 0010 — MEMBER+ may create, edit, move, and delete tasks. */
export function canMutateTasks(role: MemberRole | null): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN || role === MemberRole.MEMBER;
}
