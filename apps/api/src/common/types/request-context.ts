import type { MemberRole } from '@kurultay/shared-types';
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
};
