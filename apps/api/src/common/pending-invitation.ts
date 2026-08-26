import { InvitationStatus } from '@kurul/shared-types';
import type { Prisma } from '../generated/prisma';

/**
 * The `where` clause for a pending, unexpired invitation, shared by every caller that needs to
 * answer that question.
 *
 * `WorkspaceInvitationService.findPendingInvitations`, its pending list and
 * `PlanLimitsService.seatsUsed` each used to spell the status check and the
 * `expiresAt: { gt: now }` filter out by hand at their own call site.
 * `PlanLimitsService.seatsUsed`'s own comment already promised the settings screen and the
 * seat count "can never disagree", a promise three copied conditions cannot keep on their own.
 * One function is what makes it true: change the predicate here and every caller moves
 * together.
 *
 * `status` is a `String` column, not a Prisma enum (`schema.prisma`, `WorkspaceInvitation`), so
 * `InvitationStatus.pending` is the one shared-types constant standing in for it.
 */
export function pendingInvitationWhere(
  workspaceId: string,
  now: Date,
): Prisma.WorkspaceInvitationWhereInput {
  return {
    workspaceId,
    status: InvitationStatus.pending,
    expiresAt: { gt: now },
  };
}
