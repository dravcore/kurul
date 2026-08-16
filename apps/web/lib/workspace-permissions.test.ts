import { describe, expect, it } from 'vitest';
import { MemberRole } from '@kurul/shared-types';
import { canDeleteWorkspace, canRenameWorkspace } from './workspace-permissions';

const { OWNER, ADMIN, MEMBER, GUEST } = MemberRole;

describe('workspace permissions', () => {
  it('restricts workspace rename to ADMIN and above, matching ADMIN_ROLES', () => {
    expect(canRenameWorkspace(OWNER)).toBe(true);
    expect(canRenameWorkspace(ADMIN)).toBe(true);
    expect(canRenameWorkspace(MEMBER)).toBe(false);
    expect(canRenameWorkspace(GUEST)).toBe(false);
    expect(canRenameWorkspace(null)).toBe(false);
  });

  it('restricts workspace deletion to OWNER only, with no last-owner exception to model', () => {
    expect(canDeleteWorkspace(OWNER)).toBe(true);
    expect(canDeleteWorkspace(ADMIN)).toBe(false);
    expect(canDeleteWorkspace(MEMBER)).toBe(false);
    expect(canDeleteWorkspace(GUEST)).toBe(false);
    expect(canDeleteWorkspace(null)).toBe(false);
  });
});
