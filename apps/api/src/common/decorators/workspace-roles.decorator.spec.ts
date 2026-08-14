import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MemberRole } from '@kurultay/shared-types';
import { RolesGuard } from '../guards/roles.guard';
import { WorkspaceGuard } from '../guards/workspace.guard';
import { ROLES_KEY } from './roles.decorator';
import {
  ADMIN_ROLES,
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from './workspace-roles.decorator';

/**
 * These two decorators are the entire authorization surface for every mutating workspace route
 * (`workspace.controller.ts`, `label.controller.ts`, board/task/comment controllers) — a wrong
 * guard order or a role list one entry too wide is a real privilege escalation, not a cosmetic
 * bug, and neither would fail typecheck or lint. Asserting the metadata Nest actually stores is
 * the only mechanical net that catches it.
 */
describe('WorkspaceScoped', () => {
  it('gates on membership alone, with no role requirement', () => {
    class TestController {
      @WorkspaceScoped()
      get(): void {}
    }

    const guards = Reflect.getMetadata(GUARDS_METADATA, TestController.prototype.get) as unknown[];
    expect(guards).toEqual([WorkspaceGuard]);
  });
});

describe('WorkspaceRoles', () => {
  it('runs WorkspaceGuard before RolesGuard — RolesGuard reads the membership WorkspaceGuard resolves', () => {
    class TestController {
      @WorkspaceRoles(MemberRole.OWNER, MemberRole.ADMIN)
      update(): void {}
    }

    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TestController.prototype.update,
    ) as unknown[];
    expect(guards).toEqual([WorkspaceGuard, RolesGuard]);
  });

  it('records exactly the roles it was given, in the key RolesGuard reads', () => {
    class TestController {
      @WorkspaceRoles(MemberRole.OWNER)
      remove(): void {}
    }

    const roles = Reflect.getMetadata(ROLES_KEY, TestController.prototype.remove) as MemberRole[];
    expect(roles).toEqual([MemberRole.OWNER]);
  });
});

describe('role sets', () => {
  // A OWNER/ADMIN-only endpoint decorated with `...CONTENT_ROLES` by mistake would silently
  // hand write access to plain MEMBERs — these two sets are what stands between that typo and
  // every `@WorkspaceRoles(...ADMIN_ROLES)` call site in the app.
  it('ADMIN_ROLES is exactly OWNER and ADMIN', () => {
    expect(ADMIN_ROLES).toEqual([MemberRole.OWNER, MemberRole.ADMIN]);
  });

  it('CONTENT_ROLES adds MEMBER but still excludes GUEST', () => {
    expect(CONTENT_ROLES).toEqual([MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER]);
    expect(CONTENT_ROLES).not.toContain(MemberRole.GUEST);
  });
});
