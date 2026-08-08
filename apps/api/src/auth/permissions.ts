import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Access-control statements for the organization plugin.
 * Role keys match `MemberRole` exactly: OWNER / ADMIN / MEMBER / GUEST.
 */
export const ac = createAccessControl(defaultStatements);

export const OWNER = ac.newRole({
  ...ownerAc.statements,
});

export const ADMIN = ac.newRole({
  ...adminAc.statements,
});

/** Read-only membership — no org / member / invitation mutations. */
export const MEMBER = ac.newRole({
  ...memberAc.statements,
});

/** Same BA surface as MEMBER for Phase 2; Nest `@Roles` distinguishes later. */
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
