import { describe, expect, it } from 'vitest';
import { MemberRole } from '@kurultay/shared-types';
import { ADMIN, GUEST, MEMBER, OWNER, organizationRoles } from '../src/permissions.js';

/**
 * These assert two things the source only claims in prose, and one of them is a claim about
 * a dependency rather than about this file.
 *
 * `permissions.ts` says role keys "match `MemberRole` exactly" and that MEMBER and GUEST have
 * an "empty BA mutation surface" — but OWNER, ADMIN and MEMBER are spreads of Better Auth's
 * own `ownerAc` / `adminAc` / `memberAc`. If an upgrade widens `memberAc`, every read-only
 * role here silently gains mutations and nothing in this repo would say so. That is the
 * failure worth a test: it lands through a version bump, not through an edit anyone reviews.
 */

/** Resources whose statements grant writes; `ac` is the meta-resource and is checked apart. */
const MUTABLE_RESOURCES = ['organization', 'member', 'invitation', 'team'] as const;

type Statements = Record<string, readonly string[]>;
const statementsOf = (role: { statements: unknown }): Statements => role.statements as Statements;

describe('organizationRoles', () => {
  it('exposes exactly the product roles, under the same names', () => {
    // The two vocabularies are declared in separate packages and joined only by convention:
    // the API resolves a `MemberRole` from the database and hands the string to Better Auth.
    // A role added to one side and not the other fails at runtime, on that member's request.
    expect(Object.keys(organizationRoles).sort()).toStrictEqual(Object.values(MemberRole).sort());
  });
});

describe('read-only roles', () => {
  it.each([
    ['MEMBER', MEMBER],
    ['GUEST', GUEST],
  ])('%s grants no write on any resource', (_name, role) => {
    const statements = statementsOf(role);
    for (const resource of MUTABLE_RESOURCES) {
      expect(statements[resource] ?? []).toStrictEqual([]);
    }
    expect(statements.ac).toStrictEqual(['read']);
  });

  it('leaves MEMBER and GUEST identical to Better Auth, which is why the product layer separates them', () => {
    // They are the same permission set here on purpose — `@Roles` in Nest is what makes a
    // guest weaker than a member. Recorded so that a future difference is a decision rather
    // than a surprise: if these ever diverge, this test is the one that says so.
    expect(statementsOf(GUEST)).toStrictEqual(statementsOf(MEMBER));
  });
});

describe('elevated roles', () => {
  it('lets OWNER delete the organization', () => {
    expect(statementsOf(OWNER).organization).toContain('delete');
  });

  it('withholds organization delete from ADMIN, and nothing else', () => {
    // The single statement separating the two roles. An upgrade that granted it to ADMIN
    // would let an admin destroy the workspace that owns them.
    const admin = statementsOf(ADMIN);
    const owner = statementsOf(OWNER);

    expect(admin.organization).not.toContain('delete');
    expect(admin.organization).toContain('update');

    for (const resource of MUTABLE_RESOURCES) {
      if (resource === 'organization') continue;
      expect([...(admin[resource] ?? [])].sort()).toStrictEqual(
        [...(owner[resource] ?? [])].sort(),
      );
    }
  });
});
