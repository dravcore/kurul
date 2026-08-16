import { UseGuards, applyDecorators } from '@nestjs/common';
import { ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { MemberRole } from '@kurul/shared-types';
import { ErrorEnvelopeSchema } from '../../openapi/schemas/error.schema';
import { RolesGuard } from '../guards/roles.guard';
import { WorkspaceGuard } from '../guards/workspace.guard';
import { Roles } from './roles.decorator';

/**
 * The `404` every workspace-scoped route can answer, documented once.
 *
 * It sits on the guard decorators rather than on each handler because that is where the
 * behaviour lives: a route acquires this response by being gated, not by being remembered. A
 * new controller that writes `@WorkspaceScoped()` gets the documented `404` for free, and one
 * that does not is not scoped at all — so the spec and the guard chain cannot drift apart.
 */
const ApiWorkspaceNotFound = (): MethodDecorator & ClassDecorator =>
  ApiNotFoundResponse({
    description:
      'The workspace does not exist, or the caller is not a member of it, or the addressed ' +
      'resource belongs to another workspace. All three answer `404` — a `403` would confirm ' +
      'that something exists across the tenant boundary.',
    type: ErrorEnvelopeSchema,
  });

/**
 * Read access to anything under `:workspaceId`: membership is required, role is not.
 *
 * `WorkspaceGuard` answers 404 (never 403) for non-members, so a cross-tenant probe cannot
 * tell a forbidden workspace from a missing one.
 */
export const WorkspaceScoped = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(WorkspaceGuard), ApiWorkspaceNotFound());

/**
 * Write access under `:workspaceId`, restricted to the listed roles.
 *
 * The guard order matters and is the reason this is one decorator: `RolesGuard` reads the
 * membership that `WorkspaceGuard` resolves onto the request, so it can never run first.
 */
export const WorkspaceRoles = (...roles: MemberRole[]): MethodDecorator & ClassDecorator =>
  applyDecorators(
    UseGuards(WorkspaceGuard, RolesGuard),
    Roles(...roles),
    ApiWorkspaceNotFound(),
    // The roles are read from the same argument list the guard is given, so a route that
    // widens or narrows its gate cannot leave the documented one behind.
    ApiForbiddenResponse({
      description: `A member of the workspace whose role is not one of: ${roles.join(', ')}.`,
      type: ErrorEnvelopeSchema,
    }),
  );

/** Roles allowed to change board content (tasks, comments, labels on a task). */
export const CONTENT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER] as const;

/** Roles allowed to change board structure and workspace settings. */
export const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;
