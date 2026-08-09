import { UseGuards, applyDecorators } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { RolesGuard } from '../guards/roles.guard';
import { WorkspaceGuard } from '../guards/workspace.guard';
import { Roles } from './roles.decorator';

/**
 * Read access to anything under `:workspaceId`: membership is required, role is not.
 *
 * `WorkspaceGuard` answers 404 (never 403) for non-members, so a cross-tenant probe cannot
 * tell a forbidden workspace from a missing one.
 */
export const WorkspaceScoped = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(WorkspaceGuard));

/**
 * Write access under `:workspaceId`, restricted to the listed roles.
 *
 * The guard order matters and is the reason this is one decorator: `RolesGuard` reads the
 * membership that `WorkspaceGuard` resolves onto the request, so it can never run first.
 */
export const WorkspaceRoles = (...roles: MemberRole[]): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(WorkspaceGuard, RolesGuard), Roles(...roles));

/** Roles allowed to change board content (tasks, comments, labels on a task). */
export const CONTENT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER] as const;

/** Roles allowed to change board structure and workspace settings. */
export const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;
