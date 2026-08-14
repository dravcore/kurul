import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, MemberRole } from '@kurultay/shared-types';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import type { WorkspaceMembership } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { evictUserFromWorkspaceSockets } from '../realtime/workspace-socket-eviction';
import type { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { memberInclude, toMemberDto, type MemberRow } from './workspace-member.mapper';

/**
 * Better Auth codes that all mean "this would leave the workspace without an OWNER".
 *
 * The plugin reports them as `400`; `docs/api-conventions.md` makes a refusal caused by the
 * current state of the resource a `409`, which is also what the pre-checks below answer with,
 * so the race and the ordinary case cannot disagree about the status.
 */
const LAST_OWNER_CODES = new Set([
  'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
  'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
]);

/**
 * Better Auth codes for "the caller's role does not permit this member write".
 *
 * `remove-member` raises its version as `401`, which is wrong for us in a way a message
 * override cannot fix: the caller is authenticated, they are merely not allowed, and a `401`
 * tells the web client to send the user back through sign-in. Mapped to `403` by code.
 */
const MEMBER_WRITE_FORBIDDEN_CODES = new Set([
  'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
  'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER',
]);

const MEMBER_NOT_FOUND_MESSAGE = 'Workspace member not found';

/**
 * Membership revocation and role changes.
 *
 * ## Why every mutation goes through `auth.api.*` and not Prisma
 *
 * Better Auth owns the membership row (`organization` plugin, ADR 0004), and deleting it
 * behind the plugin's back would skip three things it does: `organizationHooks`
 * (`afterRemoveMember` is what drops the user's Socket.io rooms — see
 * `src/auth/organization-options.ts`), clearing `session.activeOrganizationId` for a session
 * pointed at the workspace the user just left, and the plugin's own last-owner invariant. The
 * HTTP routes stay firewalled off (`src/auth/organization-http-firewall.ts`); the *server*
 * API is the seam Nest is allowed to use, exactly as `WorkspaceInvitationService` does.
 *
 * ## Why the rules are re-checked here anyway
 *
 * The plugin's checks are a backstop with the wrong vocabulary: it knows `creatorRole`, not
 * our OWNER / ADMIN / MEMBER / GUEST hierarchy, and it answers `400`/`401` where
 * `docs/api-conventions.md` wants `409`/`403`. Deciding here means the refusal a client sees
 * is stated in product terms and carries the status the convention promises; the plugin's own
 * answer only surfaces for the residual race between the read and the write.
 *
 * ## Why the audit rows are written here and not in `afterRemoveMember`
 *
 * The organization hook (`src/auth/organization-options.ts`) sees the membership that was
 * deleted and the workspace it belonged to, and that is all — it does not know who ordered the
 * removal, which is the single most important field on an access-revocation record. It also
 * does not fire at all for `/organization/leave`, so half the membership departures would be
 * missing. These three methods know the actor, the target and the role on both sides, which is
 * exactly the payload the audit trail is for, so they are where it is written.
 *
 * All three write it *after* the `auth.api.*` call, with no transaction spanning the two, and
 * the resulting window is a deliberate choice rather than an oversight: a crash in between
 * loses the record of a change that happened, but recording first would invent records of
 * changes the plugin went on to refuse. A trail that under-reports is recoverable from the
 * membership rows themselves; one that reports revocations and promotions which never occurred
 * is actively misleading. Closing the window means taking the write out from under the plugin's
 * hooks, which the section above rules out.
 */
@Injectable()
export class WorkspaceMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  private headersFrom(request: Request): Headers {
    return fromNodeHeaders(request.headers);
  }

  /**
   * The target membership, or `404`.
   *
   * Scoped by `workspaceId`, so a member id from another tenant is indistinguishable from one
   * that does not exist — the same opacity `WorkspaceGuard` gives the workspace itself.
   */
  private async requireMember(workspaceId: string, userId: string): Promise<MemberRow> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }

    return member;
  }

  /** True when the workspace would be left with no OWNER once this one stops being one. */
  private async isLastOwner(workspaceId: string): Promise<boolean> {
    const owners = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: MemberRole.OWNER },
    });
    return owners <= 1;
  }

  /**
   * Re-throws a Better Auth member-write failure in the shape the convention promises.
   *
   * Only the cases where the plugin's status disagrees with ours are translated by code;
   * everything else goes to `rethrowBetterAuthError`, which keeps 4xx statuses, hides library
   * messages and re-throws 5xx untouched.
   */
  private rethrowMemberWriteError(
    error: unknown,
    message: string,
    lastOwnerMessage: string,
  ): never {
    const code = betterAuthErrorCode(error);

    if (code !== undefined && LAST_OWNER_CODES.has(code)) {
      throw new ConflictException(lastOwnerMessage);
    }
    if (code !== undefined && MEMBER_WRITE_FORBIDDEN_CODES.has(code)) {
      throw new ForbiddenException(message);
    }
    if (code === 'MEMBER_NOT_FOUND') {
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }

    rethrowBetterAuthError(error, message, { 404: MEMBER_NOT_FOUND_MESSAGE });
  }

  /**
   * Removes another member from the workspace. OWNER / ADMIN only (`@WorkspaceRoles`).
   *
   * | Case                          | Answer                                       |
   * | ----------------------------- | -------------------------------------------- |
   * | target is the caller          | `400` — leaving is a different decision       |
   * | target not in this workspace  | `404`                                        |
   * | target is OWNER, caller ADMIN | `403`                                        |
   * | target is the last OWNER      | `409`                                        |
   *
   * Self-removal is refused rather than aliased to `leave`. The two are the same row write but
   * not the same act: one is an admin revoking someone's access, the other is a person giving
   * up their own, and only the second is available to a MEMBER or GUEST. Folding them together
   * would mean an admin's "remove" client bug silently locks the admin out of the workspace,
   * and it would put a self-service action behind an admin-only gate. `400`, not `403`: the
   * caller *is* allowed here, they have just addressed the wrong endpoint, and the message
   * names the right one.
   */
  async removeMember(
    workspaceId: string,
    targetUserId: string,
    actor: WorkspaceMembership,
    request: Request,
  ): Promise<void> {
    if (targetUserId === actor.userId) {
      throw new BadRequestException(
        'Use POST /workspaces/:workspaceId/members/me/leave to remove yourself',
      );
    }

    const target = await this.requireMember(workspaceId, targetUserId);

    if (target.role === MemberRole.OWNER) {
      // Authorization before state: an ADMIN aiming at an OWNER is refused for who they are,
      // and is not told how many owners the workspace has.
      if (actor.role !== MemberRole.OWNER) {
        throw new ForbiddenException('Only an OWNER can remove another OWNER');
      }
      // Unreachable while `targetUserId !== actor.userId` holds and the caller is the sole
      // OWNER — but it is the invariant, not a consequence of the check above, so it is
      // stated rather than inferred.
      if (await this.isLastOwner(workspaceId)) {
        throw new ConflictException('The last OWNER cannot be removed from the workspace');
      }
    }

    try {
      // `memberIdOrEmail` takes the membership row id. The lookup above already scoped it to
      // this workspace, so the plugin's own tenant check can only ever agree.
      await auth.api.removeMember({
        body: { memberIdOrEmail: target.id, organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      this.rethrowMemberWriteError(
        error,
        'Failed to remove the member',
        'The last OWNER cannot be removed from the workspace',
      );
    }

    // After the plugin call, never before: Better Auth owns the membership row and there is no
    // transaction spanning the two, so an entry written first would outlive a removal the
    // plugin refused. The reverse gap — a crash between the two writes — loses the record of a
    // removal that happened, which is the worse of the two failures but the only one available
    // without moving the delete out from under the plugin's hooks.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actor.userId,
      type: ActivityType.MemberRemoved,
      payload: {
        targetUserId,
        targetName: target.user.name,
        // The role the removed member held. Without it the entry cannot distinguish an
        // ordinary member being let go from an administrator being locked out.
        previousRole: target.role,
        actorRole: actor.role,
      },
    });

    // `afterRemoveMember` (organization-options.ts) already evicted the user's sockets.
  }

  /**
   * Changes another member's role, or the caller's own. OWNER / ADMIN only.
   *
   * | Case                              | Answer                                  |
   * | --------------------------------- | --------------------------------------- |
   * | target not in this workspace      | `404`                                   |
   * | role unchanged                    | `200`, no write                         |
   * | target is OWNER, caller ADMIN     | `403`                                   |
   * | promoting to OWNER, caller ADMIN  | `403`                                   |
   * | demoting the last OWNER           | `409`                                   |
   *
   * ### No socket eviction on a downgrade
   *
   * Deliberate. Socket rooms are gated on *membership*, never on role: `RealtimeGateway`
   * `board:join` requires a row in `WorkspaceMember` and `notifications:join` requires the
   * same (`src/realtime/realtime.gateway.ts`), and neither reads `role`. A GUEST joins exactly
   * the rooms a MEMBER joins, so a MEMBER→GUEST downgrade removes no room the user is still
   * sitting in and evicting would only cost a reconnect. Nothing is *written* over a socket
   * either — every mutation is an HTTP request that re-reads the membership through
   * `WorkspaceGuard` and re-checks it in `RolesGuard`, so a downgrade takes effect on the very
   * next request with no realtime involvement. The day a room becomes role-gated, this
   * decision has to be revisited and `evictUserFromWorkspaceSockets` called here.
   */
  async updateMemberRole(
    workspaceId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
    actor: WorkspaceMembership,
    request: Request,
  ): Promise<WorkspaceMemberDto> {
    const target = await this.requireMember(workspaceId, targetUserId);
    const nextRole = dto.role;

    if (target.role === nextRole) {
      return toMemberDto(target);
    }

    const targetIsOwner = target.role === MemberRole.OWNER;
    const promotingToOwner = nextRole === MemberRole.OWNER;

    if ((targetIsOwner || promotingToOwner) && actor.role !== MemberRole.OWNER) {
      // One message for both directions on purpose: an ADMIN may neither demote an OWNER nor
      // mint one, and the two refusals should not read as different rules.
      throw new ForbiddenException('Only an OWNER can change ownership');
    }

    if (targetIsOwner && (await this.isLastOwner(workspaceId))) {
      throw new ConflictException('The last OWNER cannot be demoted; promote another OWNER first');
    }

    try {
      await auth.api.updateMemberRole({
        body: { memberId: target.id, role: nextRole, organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      this.rethrowMemberWriteError(
        error,
        'Failed to change the member role',
        'The last OWNER cannot be demoted; promote another OWNER first',
      );
    }

    // The entry an escalation investigation actually reads: both roles, named, plus who
    // ordered it. `target.role === nextRole` returned above without writing, so every row here
    // is a real change and the two fields are never equal.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actor.userId,
      type: ActivityType.MemberRoleChanged,
      payload: {
        targetUserId,
        targetName: target.user.name,
        previousRole: target.role,
        newRole: nextRole,
        actorRole: actor.role,
      },
    });

    return toMemberDto({ ...target, role: nextRole });
  }

  /**
   * The caller leaves the workspace. Any member, any role — `@WorkspaceScoped`.
   *
   * The sole OWNER is refused with `409`: ownership has to be handed to someone else first,
   * or the workspace deleted outright, otherwise it would be left with no one who can do
   * either.
   */
  async leave(workspaceId: string, actor: WorkspaceMembership, request: Request): Promise<void> {
    const membership = await this.requireMember(workspaceId, actor.userId);

    if (membership.role === MemberRole.OWNER && (await this.isLastOwner(workspaceId))) {
      throw new ConflictException(
        'The last OWNER cannot leave the workspace; transfer ownership or delete the workspace',
      );
    }

    try {
      await auth.api.leaveOrganization({
        body: { organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      this.rethrowMemberWriteError(
        error,
        'Failed to leave the workspace',
        'The last OWNER cannot leave the workspace; transfer ownership or delete the workspace',
      );
    }

    // Its own type, not `member.removed`: a departure and a revocation are the same row write
    // and completely different facts, and an investigation that cannot tell "they walked out"
    // from "they were locked out" has learned nothing. `userId` is the actor *and* the subject
    // here, which is what makes the distinction readable without joining anything.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actor.userId,
      type: ActivityType.MemberLeft,
      payload: {
        targetUserId: actor.userId,
        targetName: membership.user.name,
        previousRole: membership.role,
      },
    });

    // `/organization/leave` deletes the membership without running `afterRemoveMember` — the
    // hook is wired to `remove-member` only (better-auth 1.6 `routes/crud-members.ts`). So the
    // eviction that route gets for free has to be made explicitly here, or a member who walked
    // out would keep receiving this workspace's board and notification events on an open
    // socket until they happen to disconnect.
    await evictUserFromWorkspaceSockets(workspaceId, actor.userId);
  }
}
