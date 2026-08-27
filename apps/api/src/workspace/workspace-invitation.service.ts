import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, InvitationStatus, MemberRole } from '@kurul/shared-types';
import type { CursorPage, InvitationDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import { buildInviteAcceptUrl } from '../auth/web-urls';
import { toCursorPage } from '../common/pagination/cursor-page';
import { MAX_PAGE_LIMIT } from '../common/pagination/page-limit';
import { pendingInvitationWhere } from '../common/pending-invitation';
import { captureMailDelivery } from '../mail/mail-delivery-scope';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import type { WorkspaceInvitationQueryDto } from './dto/workspace-invitation-query.dto';

/**
 * Better Auth's code for "this session's address is not verified", raised by
 * accept/reject/get-invitation because `requireEmailVerificationOnInvitation` is on.
 */
const EMAIL_NOT_VERIFIED_CODE =
  'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION';

/**
 * Message the web client keys on to offer "resend verification email".
 *
 * Unlike the other invitation failures this one is deliberately specific: it describes the
 * caller's own account to the caller, so it reveals nothing about anyone else, and a generic
 * "Failed to accept invitation" would look like a broken invitation instead of a step the
 * user still has to take.
 */
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Confirm your email address before accepting this invitation';

/** The stored columns every invitation read maps from. */
type InvitationRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
};

/**
 * A stored invitation as the API describes it.
 *
 * `role` is nullable in the schema because Better Auth's own column is, but every invitation
 * this API creates goes through `auth.api.createInvitation` with an explicit role, and the
 * plugin's role union is pinned to ours (`organization-options.ts`). A row without one is
 * therefore something we did not write, and the only safe reading of "no role recorded" is the
 * least privileged one — inventing MEMBER would show an admin an invitation that grants more
 * than the row can prove it grants.
 *
 * `acceptUrl` is rebuilt from the id by the same helper the invitation email uses, so the link
 * an admin copies out of the roster and the link in the invitee's inbox cannot diverge.
 *
 * `emailDelivery` is deliberately absent here. A listed invitation is a stored row and delivery
 * is not stored, so this mapper has nothing to report; only `createInvitation`, which watched
 * the send happen, sets it. See the field's contract in `@kurul/shared-types`.
 */
function toInvitationDto(row: InvitationRow): InvitationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: (row.role as MemberRole | null) ?? MemberRole.GUEST,
    status: row.status as InvitationStatus,
    expiresAt: row.expiresAt.toISOString(),
    acceptUrl: buildInviteAcceptUrl(row.id),
  };
}

/**
 * Invitation lifecycle.
 *
 * ## The invited address is deliberately **not** in the audit payload
 *
 * The obvious payload for `invitation.created` is the address it was aimed at, and it is the
 * wrong one. The two endpoints are gated differently on purpose:
 *
 * - `GET /workspaces/:workspaceId/invitations` — `@WorkspaceRoles(...ADMIN_ROLES)`
 * - `GET /workspaces/:workspaceId/activities` — `@WorkspaceScoped()`, so every member reads it
 *
 * and `ActivityService.list` returns `payload` verbatim. Putting the address on the activity
 * row would therefore republish the pending-invitation queue to every MEMBER and GUEST in the
 * workspace, through a feed that was never gated for it. That is exactly the exposure the
 * comment above `WorkspaceController.listInvitations` refuses: an invited address belongs to
 * someone who has agreed to nothing yet, and handing it to the whole workspace shares contact
 * details the product was never given permission to share. An audit trail must not open that
 * door from behind.
 *
 * So these payloads carry `invitationId` and the granted role, and stop there. Nothing forensic
 * is lost: `WorkspaceInvitation` still holds the address, an admin joins the two by id, and the
 * join is available to exactly the readers the invitation list already serves. `ACTIVITY_RETENTION_DAYS`
 * sweeps these rows like any other activity, which is a second reason not to copy personal data
 * into them — the copy would outlive nothing and expose more.
 *
 * ## The audit rows are written after the plugin call, and that gap is deliberate
 *
 * Better Auth owns the invitation row and no transaction spans the two writes, so a crash
 * between them loses the record of something that happened. Recording *first* would be worse:
 * it would fabricate entries for invitations the plugin went on to refuse, and an audit trail
 * that reports access which was never granted is not a weaker trail, it is a misleading one.
 */
@Injectable()
export class WorkspaceInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  private headersFrom(request: Request): Headers {
    return fromNodeHeaders(request.headers);
  }

  /**
   * Pending, unexpired invitations for an email in a workspace.
   *
   * Mirrors the organization plugin's own lookup exactly — same lower-cased email, same
   * `pending` status, same expiry filter — so the decision made in `createInvitation` is
   * taken over the same rows the plugin would act on.
   */
  private async findPendingInvitations(
    workspaceId: string,
    email: string,
  ): Promise<{ id: string; role: string | null }[]> {
    return this.prisma.workspaceInvitation.findMany({
      where: { ...pendingInvitationWhere(workspaceId, new Date()), email },
      select: { id: true, role: true },
    });
  }

  /**
   * One cursor page of the invitations still waiting for an answer.
   *
   * ## Why "pending" is a filter and not a `?status=` parameter
   *
   * The only thing anyone can still *do* to an invitation is revoke it, and that is only
   * meaningful while it is pending: an accepted one is a membership and already appears in the
   * roster, while a canceled or rejected one is a decision that has been made. Serving the
   * closed ones would grow the settings screen a history with no available action on any row,
   * and it would keep publishing the email addresses of people who explicitly said no.
   *
   * Expiry uses the same `expiresAt > now` comparison as `findPendingInvitations`, so what an
   * admin sees as revocable and what `createInvitation` treats as an existing invitation to
   * resend can never disagree. An expired row is deliberately not listed: revoking it changes
   * nothing, and re-inviting the same address is a fresh invitation, not an action on this one.
   *
   * Ordered and paged by `id` — UUIDv7, so ascending id is the order the invitations were
   * sent (docs/api-conventions.md#the-cursor-key-is-always-id-never-position).
   */
  async listPendingInvitations(
    workspaceId: string,
    query: WorkspaceInvitationQueryDto,
  ): Promise<CursorPage<InvitationDto>> {
    const limit = query.limit ?? MAX_PAGE_LIMIT;

    const rows = await this.prisma.workspaceInvitation.findMany({
      where: {
        ...pendingInvitationWhere(workspaceId, new Date()),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, toInvitationDto);
  }

  /**
   * Invites an email to the workspace, or re-issues the pending invitation it already has.
   *
   * `resend: true` tells the organization plugin to return the existing pending invitation
   * with a refreshed expiry instead of creating a second one — but it returns it *unchanged
   * otherwise*, including its role. Re-inviting someone at a different role would therefore
   * report success while quietly keeping the old role. So the two cases are separated here:
   *
   * - **Same role** — resend, which is exactly what the admin asked for.
   * - **Different role** — revoke the pending invitation first, so the plugin issues a fresh
   *   one at the requested role and the response (id, `acceptUrl`, role) describes it.
   *
   * ## Why the plugin call is wrapped in `captureMailDelivery`
   *
   * The invitation email is sent from inside `auth.api.createInvitation`, by the plugin's
   * `sendInvitationEmail` hook, and its outcome used to reach nobody but the log: on a
   * deployment with no SMTP host the API answered `201`, wrote "Email not sent (no SMTP)" to
   * stdout, and the admin found out days later from a teammate who never got anything. The
   * capture is the return channel that closes that gap — the response now carries
   * `emailDelivery`, and the web app turns a non-`SENT` value into a message pointing at the
   * copyable accept link (audit PM-04).
   *
   * It does **not** make delivery a precondition. An undeliverable invitation is still a
   * created invitation: the row exists, the link works, and someone who is already verified
   * can accept it. Failing the request here would delete the one path that still works on a
   * deployment without mail.
   */
  async createInvitation(
    workspaceId: string,
    actorId: string,
    dto: CreateInvitationDto,
    request: Request,
  ): Promise<InvitationDto> {
    if (dto.role === MemberRole.OWNER) {
      throw new BadRequestException('Cannot invite someone as OWNER');
    }

    const headers = this.headersFrom(request);
    // Better Auth stores and matches invitation emails lower-cased.
    const email = dto.email.toLowerCase();

    const pending = await this.findPendingInvitations(workspaceId, email);

    // A pending invitation holds a seat (ADR 0032), so the ceiling is checked before one more
    // is offered. That way the refusal reaches the admin who can free a seat, not the invitee
    // who cannot. A resend of an invitation this workspace already holds is not a new seat,
    // and is not refused: `pending` is non-empty exactly then.
    if (pending.length === 0) {
      await this.planLimits.assertSeatAvailable(workspaceId, { countsInvitations: true });
    }

    if (pending.some((invitation) => invitation.role !== dto.role)) {
      for (const invitation of pending) {
        try {
          await auth.api.cancelInvitation({
            body: { invitationId: invitation.id },
            headers,
          });
        } catch (error) {
          rethrowBetterAuthError(error, 'Failed to replace the pending invitation');
        }
      }
    }

    try {
      const { result: invitation, delivery } = await captureMailDelivery(() =>
        auth.api.createInvitation({
          body: {
            email,
            role: dto.role,
            organizationId: workspaceId,
            resend: true,
          },
          headers,
        }),
      );

      if (!invitation?.id || !invitation.email || !invitation.status || !invitation.expiresAt) {
        throw new BadRequestException('Failed to create invitation');
      }

      // Closes the remaining race: if another admin created a pending invitation between
      // the lookup above and this call, `resend: true` returned *theirs*, at their role.
      // Reporting that as the requested role is the exact silent loss this method prevents.
      const grantedRole = invitation.role as MemberRole | undefined;
      if (grantedRole !== undefined && grantedRole !== dto.role) {
        throw new ConflictException('Invitation was changed concurrently, please try again');
      }

      // Written after the concurrency check, so no entry claims a grant the response refused.
      // `emailDelivery` is recorded next to the grant because the two answer one question
      // together: an invitation whose mail never left the building was still an offer of
      // access, and the link in the response works whether or not it was delivered. It is a
      // verdict about the send, not the address — see the class comment for why the address
      // itself stays in `WorkspaceInvitation`, joined by `invitationId`.
      await this.activityService.record(this.prisma, {
        workspaceId,
        userId: actorId,
        type: ActivityType.InvitationCreated,
        payload: {
          invitationId: invitation.id,
          role: dto.role,
          ...(delivery === undefined ? {} : { emailDelivery: delivery }),
        },
      });

      return {
        id: invitation.id,
        workspaceId,
        email: invitation.email,
        role: dto.role,
        status: invitation.status as InvitationStatus,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
        // Same builder the invitation email uses, so the link an admin copies from the UI and
        // the link in the invitee's inbox can never point at different routes.
        acceptUrl: buildInviteAcceptUrl(invitation.id),
        // Spread rather than `emailDelivery: delivery`: `undefined` means "no send was
        // observed", and the contract is that the *field is absent* in that case, so a client
        // cannot read the absence as a verdict. `exactOptionalPropertyTypes` would reject the
        // explicit `undefined` anyway.
        ...(delivery === undefined ? {} : { emailDelivery: delivery }),
      };
    } catch (error) {
      // Deliberately generic: the plugin distinguishes "already a member" from "already
      // invited" from "no such user", and passing that through would turn this endpoint
      // into an email-enumeration oracle.
      rethrowBetterAuthError(error, 'Failed to create invitation', {
        403: 'You are not allowed to send this invitation',
      });
    }
  }

  async revokeInvitation(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    request: Request,
  ): Promise<void> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    try {
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to revoke invitation', {
        404: 'Invitation not found',
      });
    }

    // Cancelling only flips `status`, so the row survives — but it stops being listed, and an
    // invitation that was withdrawn one minute after it was sent is a different story from one
    // that was left standing. The pair of entries is what tells them apart, and because the row
    // is still there, `invitationId` is all an admin needs to recover the address.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actorId,
      type: ActivityType.InvitationRevoked,
      payload: {
        invitationId,
        role: invitation.role,
      },
    });
  }

  async acceptInvitation(
    workspaceId: string,
    invitationId: string,
    request: Request,
  ): Promise<WorkspaceMemberDto> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });
    if (
      !invitation ||
      invitation.status !== InvitationStatus.pending ||
      invitation.workspaceId !== workspaceId
    ) {
      throw new NotFoundException('Invitation not found');
    }

    // Members only, not members plus invitations: the invitation being accepted is one of the
    // pending ones and is about to stop being pending, so counting both would refuse the last
    // seat of a workspace that has room for exactly the person walking through the door
    // (ADR 0032). The check earns its place anyway: the ceiling can be lowered, or a seat
    // taken by another acceptance, in the days between the invitation and the click.
    await this.planLimits.assertSeatAvailable(workspaceId, { countsInvitations: false });

    try {
      const result = await auth.api.acceptInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });

      const member = result?.member;
      if (!member) {
        throw new BadRequestException('Failed to accept invitation');
      }

      const memberWorkspaceId =
        'organizationId' in member && typeof member.organizationId === 'string'
          ? member.organizationId
          : workspaceId;

      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: member.userId },
        select: { name: true, avatarUrl: true },
      });

      // The other half of `invitation.created`: an offer of access and its acceptance are two
      // separate acts, days apart, and only the second one actually granted anything. The actor
      // is the invitee, who at the moment of writing has just become a member — which is why
      // this is the one audited event whose actor is not an administrator.
      //
      // No address here either, and here it is not even a trade-off: the invitee is now a
      // member, so `userId` names them directly and joins to `User` for anything else.
      await this.activityService.record(this.prisma, {
        workspaceId: memberWorkspaceId,
        userId: member.userId,
        type: ActivityType.InvitationAccepted,
        payload: {
          invitationId,
          role: member.role,
        },
      });

      return {
        id: member.id,
        workspaceId: memberWorkspaceId,
        userId: member.userId,
        role: member.role as MemberRole,
        name: user.name,
        avatarUrl: user.avatarUrl,
      };
    } catch (error) {
      if (betterAuthErrorCode(error) === EMAIL_NOT_VERIFIED_CODE) {
        throw new ForbiddenException(EMAIL_NOT_VERIFIED_MESSAGE);
      }

      rethrowBetterAuthError(error, 'Failed to accept invitation', {
        404: 'Invitation not found',
      });
    }
  }
}
