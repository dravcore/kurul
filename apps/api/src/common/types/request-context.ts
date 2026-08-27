import type { MemberRole } from '@kurul/shared-types';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: Date;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
}

export type AuthedRequest = Request & {
  user?: AuthenticatedUser;
  membership?: WorkspaceMembership;
  /**
   * Set by `SessionAuthGuard` when the request authenticated with a personal access token rather
   * than a session cookie. Absent on every cookie request.
   *
   * `workspaceId` is the one fact the guards need beyond the user: `WorkspaceGuard` answers
   * `404` for any `:workspaceId` that is not this one, exactly as it does for a non-member, and
   * `SessionAuthGuard` refuses a route that has no `:workspaceId` at all.
   */
  accessToken?: { id: string; workspaceId: string };
};
