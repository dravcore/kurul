import { SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@kurultay/shared-types';

export const ROLES_KEY = 'roles';

/** Require one of the listed workspace roles (checked after WorkspaceGuard). */
export const Roles = (...roles: MemberRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
