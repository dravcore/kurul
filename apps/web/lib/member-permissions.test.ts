import { describe, expect, it } from 'vitest';
import { MemberRole } from '@kurul/shared-types';
import {
  INVITABLE_ROLES,
  assignableRoles,
  canChangeOwnership,
  canManageMember,
  canManageMembers,
} from './member-permissions';

describe('canManageMembers', () => {
  it('matches ADMIN_ROLES on the workspace controller', () => {
    expect(canManageMembers(MemberRole.OWNER)).toBe(true);
    expect(canManageMembers(MemberRole.ADMIN)).toBe(true);
    expect(canManageMembers(MemberRole.MEMBER)).toBe(false);
    expect(canManageMembers(MemberRole.GUEST)).toBe(false);
    // The shell has no role yet during bootstrap; nothing is offered until it does.
    expect(canManageMembers(null)).toBe(false);
  });
});

describe('canManageMember', () => {
  it('lets an ADMIN act on everyone below an OWNER', () => {
    expect(canManageMember(MemberRole.ADMIN, MemberRole.ADMIN)).toBe(true);
    expect(canManageMember(MemberRole.ADMIN, MemberRole.MEMBER)).toBe(true);
    expect(canManageMember(MemberRole.ADMIN, MemberRole.GUEST)).toBe(true);
  });

  it('keeps an ADMIN away from an OWNER, which is where the API answers 403', () => {
    expect(canManageMember(MemberRole.ADMIN, MemberRole.OWNER)).toBe(false);
    expect(canManageMember(MemberRole.OWNER, MemberRole.OWNER)).toBe(true);
  });

  it('offers nothing at all to a MEMBER', () => {
    expect(canManageMember(MemberRole.MEMBER, MemberRole.GUEST)).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('offers OWNER only to an OWNER — promotion is how ownership is handed over', () => {
    expect(canChangeOwnership(MemberRole.OWNER)).toBe(true);
    expect(assignableRoles(MemberRole.OWNER)).toContain(MemberRole.OWNER);
    expect(assignableRoles(MemberRole.ADMIN)).not.toContain(MemberRole.OWNER);
  });

  it('never offers OWNER on an invitation — the DTO rejects it outright', () => {
    expect(INVITABLE_ROLES).not.toContain(MemberRole.OWNER);
    expect([...INVITABLE_ROLES]).toEqual([MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.GUEST]);
  });
});
