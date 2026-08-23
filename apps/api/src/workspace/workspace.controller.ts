import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MemberRole } from '@kurul/shared-types';
import type {
  CursorPage,
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import type { Request } from 'express';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import { SessionOnlyGuard } from '../common/guards/session-only.guard';
import { ThrottleInvitations } from '../common/rate-limit/rate-limit';
import { DemoRestrictedGuard } from '../demo/demo-restricted.guard';
import type { AuthenticatedUser, WorkspaceMembership } from '../common/types/request-context';
import { ErrorEnvelopeSchema } from '../openapi/schemas/error.schema';
import {
  InvitationPageSchema,
  InvitationSchema,
  WorkspaceMemberPageSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
} from '../openapi/schemas/workspace.schema';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceInvitationQueryDto } from './dto/workspace-invitation-query.dto';
import { WorkspaceMemberQueryDto } from './dto/workspace-member-query.dto';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceService } from './workspace.service';

/**
 * The writes below are performed by Better Auth's organization plugin, which reads the caller
 * from the request's session cookie and nothing else. A personal access token authenticates
 * the Nest guards but carries no session for the plugin to find, so rather than let the
 * plugin answer a misleading `401` to a valid credential, these handlers refuse a token up
 * front with a `403` that says what is wrong. Lifting this means moving the write out from
 * under the plugin (see `WorkspaceMemberService`'s header comment for why it sits there), and
 * that is a decision for the `/v1` surface, not for this slice (ROADMAP, "API 1.0").
 */
const SessionOnly = (): MethodDecorator =>
  applyDecorators(
    UseGuards(SessionOnlyGuard),
    ApiForbiddenResponse({
      description:
        'Also answered when the request authenticated with a personal access token: this ' +
        'operation is performed by Better Auth and takes a session cookie only.',
      type: ErrorEnvelopeSchema,
    }),
  );

@ApiTags('Workspaces')
@Controller('workspaces')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly invitationService: WorkspaceInvitationService,
    private readonly memberService: WorkspaceMemberService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the workspaces the caller belongs to',
    description:
      'The one collection in this API with no `:workspaceId` above it \u2014 it *is* how a ' +
      'caller discovers their tenants. Bounded by membership, so it is a plain array.',
  })
  @ApiOkResponse({ type: [WorkspaceSchema] })
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceDto[]> {
    return this.workspaceService.listForUser(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a workspace',
    description: 'The caller becomes its `OWNER`. A duplicate `slug` is `409`.',
  })
  @ApiCreatedResponse({ type: WorkspaceSchema })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.create(user.id, dto, request);
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Read one workspace' })
  @ApiOkResponse({ type: WorkspaceSchema })
  @WorkspaceScoped()
  get(@UuidParam('workspaceId') workspaceId: string): Promise<WorkspaceDto> {
    return this.workspaceService.getById(workspaceId);
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Rename a workspace, or change its slug' })
  @ApiOkResponse({ type: WorkspaceSchema })
  @WorkspaceRoles(...ADMIN_ROLES)
  @SessionOnly()
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.update(workspaceId, user.id, dto, request);
  }

  @Delete(':workspaceId')
  @ApiOperation({
    summary: 'Delete a workspace',
    description:
      'OWNER only \u2014 the one route in the API gated on a single role rather than a role set. ' +
      'Cascades to every board, task and file in it. Answers `403` on a demo instance, where ' +
      'the one shared workspace is what every other visitor is currently looking at.',
  })
  @ApiNoContentResponse({ description: 'Deleted. Empty body.' })
  @HttpCode(204)
  @UseGuards(DemoRestrictedGuard)
  @WorkspaceRoles(MemberRole.OWNER)
  @SessionOnly()
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.remove(workspaceId, user.id, request);
  }

  /**
   * Declared before `:workspaceId/members` is irrelevant here — `/members/me` is a longer
   * path, not a parameter that could swallow it — but the two stay adjacent on purpose: a
   * caller that only needs its own role should never reach for the list.
   */
  @Get(':workspaceId/members/me')
  @ApiOperation({
    summary: "Read the caller's own membership",
    description: 'A caller that only needs its own role should never page the roster to find it.',
  })
  @ApiOkResponse({ type: WorkspaceMemberSchema })
  @WorkspaceScoped()
  getOwnMembership(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberDto> {
    return this.workspaceService.getMembership(workspaceId, user.id);
  }

  /**
   * Leaving is self-service, so it is `@WorkspaceScoped` and not role-gated: a GUEST who was
   * invited by mistake must be able to walk out without asking an admin to let them.
   *
   * Declared ahead of `members/:userId` because `me` is not a UUIDv7 and would otherwise be
   * rejected by `@UuidParam` before this handler was ever considered.
   *
   * 204: the caller's membership is gone, so there is nothing left to return about it.
   */
  @Post(':workspaceId/members/me/leave')
  @ApiOperation({
    summary: 'Leave a workspace',
    description:
      'Self-service and deliberately not role-gated: a GUEST invited by mistake must be able to ' +
      'walk out without asking an admin. `204` because the membership it acted on is gone.',
  })
  @ApiNoContentResponse({ description: 'Left. Empty body.' })
  @HttpCode(204)
  @WorkspaceScoped()
  @SessionOnly()
  async leaveWorkspace(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<void> {
    await this.memberService.leave(workspaceId, membership, request);
  }

  @Get(':workspaceId/members')
  @ApiOperation({
    summary: 'Page the member roster',
    description:
      'A cursor page whose `limit` defaults to the 100 ceiling, so an ordinary workspace is one ' +
      'request answering `hasMore: false`. It is paginated at all because "members are always ' +
      'few" is an expectation rather than a construction \u2014 a plain array behind `take: 1000` ' +
      'lost a large workspace its tail with nothing in the response saying so.',
  })
  @ApiOkResponse({ type: WorkspaceMemberPageSchema })
  @WorkspaceScoped()
  listMembers(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: WorkspaceMemberQueryDto,
  ): Promise<CursorPage<WorkspaceMemberDto>> {
    return this.workspaceService.listMembers(workspaceId, query);
  }

  /**
   * Revoke a member's access. Addressed by `userId`, not by membership id: the caller who
   * wants someone out knows *who*, and the membership row id is an implementation detail of
   * the roster response.
   */
  @Delete(':workspaceId/members/:userId')
  @ApiOperation({
    summary: 'Remove a member',
    description:
      'Addressed by `userId` rather than by membership id: the caller knows *who*, and the row ' +
      'id is an implementation detail of the roster response.',
  })
  @ApiNoContentResponse({ description: 'Removed. Empty body.' })
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  @SessionOnly()
  async removeMember(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('userId') userId: string,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<void> {
    await this.memberService.removeMember(workspaceId, userId, membership, request);
  }

  /**
   * `PATCH .../role` rather than `PATCH .../members/:userId`: role is the only mutable field
   * of a membership, and a sub-resource says so in the URL instead of leaving callers to
   * discover that every other key is rejected.
   */
  @Patch(':workspaceId/members/:userId/role')
  @ApiOperation({
    summary: "Change a member's role",
    description:
      '`/role` rather than `PATCH .../members/{userId}`: role is the only mutable field of a ' +
      'membership, and the sub-resource says so instead of leaving callers to discover that ' +
      'every other key is rejected.',
  })
  @ApiOkResponse({ type: WorkspaceMemberSchema })
  @WorkspaceRoles(...ADMIN_ROLES)
  @SessionOnly()
  updateMemberRole(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.memberService.updateMemberRole(workspaceId, userId, dto, membership, request);
  }

  /**
   * The invitations still awaiting an answer. OWNER / ADMIN only, unlike the roster beside it.
   *
   * `@WorkspaceScoped` would have been the consistent-looking choice — both are lists of
   * people attached to the workspace — and it is the wrong one. A member has joined and is
   * visible to the workspace by their own decision; an invited address belongs to someone who
   * has agreed to nothing yet, and publishing the queue to every GUEST would hand out contact
   * details the product was never given permission to share. The gate also matches what the
   * list is *for*: revoking, which is admin-only anyway.
   */
  @Get(':workspaceId/invitations')
  @ApiOperation({
    summary: 'Page the pending invitations',
    description:
      'Admin-only, unlike the roster beside it. A member is visible by their own decision; an ' +
      'invited address belongs to someone who has agreed to nothing yet, and publishing the ' +
      'queue to every GUEST would hand out contact details nobody consented to share.',
  })
  @ApiOkResponse({ type: InvitationPageSchema })
  @WorkspaceRoles(...ADMIN_ROLES)
  listInvitations(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: WorkspaceInvitationQueryDto,
  ): Promise<CursorPage<InvitationDto>> {
    return this.invitationService.listPendingInvitations(workspaceId, query);
  }

  /**
   * Rate limited below the API default: every call hands a message to the SMTP relay, aimed
   * at an address the caller chooses, so an admin account is enough to turn this endpoint
   * into a mail cannon pointed at someone else's inbox.
   */
  @Post(':workspaceId/invitations')
  @ApiOperation({
    summary: 'Invite somebody to the workspace',
    description:
      'The response carries `emailDelivery`, and **an absent field is not `SENT`** \u2014 it means ' +
      'this API observed no send. Delivery never fails the request: on a deployment with no ' +
      'SMTP the `acceptUrl` in the body is the path that works. Rate limited well below the ' +
      'default, because each call hands a message to the relay aimed at an address the caller ' +
      'chooses.',
  })
  @ApiCreatedResponse({ type: InvitationSchema })
  @ThrottleInvitations()
  @WorkspaceRoles(...ADMIN_ROLES)
  @SessionOnly()
  createInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    return this.invitationService.createInvitation(workspaceId, user.id, dto, request);
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  @ApiNoContentResponse({ description: 'Revoked. Empty body.' })
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  @SessionOnly()
  async revokeInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.invitationService.revokeInvitation(workspaceId, user.id, invitationId, request);
  }

  /**
   * Accept is session-authenticated but not membership-gated — the invitee is not a
   * member until after accept. `:workspaceId` must match the invitation's workspace.
   *
   * 200, not 201: this is an action on an existing invitation (api-conventions), and the
   * membership it returns has no URL of its own for a `Location` header to point at.
   */
  @Post(':workspaceId/invitations/:invitationId/accept')
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Session-authenticated but **not** membership-gated, and the only workspace-scoped route ' +
      'that is not: the invitee is not a member until this succeeds. `200` rather than `201` ' +
      'because it acts on an existing invitation, and the membership it returns has no URL of ' +
      'its own for a `Location` header to point at.',
  })
  @ApiOkResponse({ type: WorkspaceMemberSchema })
  @HttpCode(200)
  @SessionOnly()
  acceptInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.invitationService.acceptInvitation(workspaceId, invitationId, request);
  }
}
