import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/** Mirrors apps/api/src/auth/permissions.ts — role keys match MemberRole. */
export const ac = createAccessControl(defaultStatements);

export const OWNER = ac.newRole({
  ...ownerAc.statements,
});

export const ADMIN = ac.newRole({
  ...adminAc.statements,
});

export const MEMBER = ac.newRole({
  ...memberAc.statements,
});

export const GUEST = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
});

export const organizationRoles = {
  OWNER,
  ADMIN,
  MEMBER,
  GUEST,
} as const;
