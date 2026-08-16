import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, MailDeliveryStatus, MemberRole } from '@kurul/shared-types';
import { APIError } from 'better-auth/api';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import { recordMailDelivery } from '../mail/mail-delivery-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_NOT_VERIFIED_MESSAGE,
  WorkspaceInvitationService,
} from './workspace-invitation.service';

// `auth.ts` opens a Postgres pool and demands DATABASE_URL / BETTER_AUTH_SECRET at import
// time, so the whole module is replaced — these tests are about what the service does with
// the plugin's answers, not about the plugin.
jest.mock('../auth/auth', () => ({
  auth: {
    api: {
      createInvitation: jest.fn(),
      cancelInvitation: jest.fn(),
      acceptInvitation: jest.fn(),
      createOrganization: jest.fn(),
      updateOrganization: jest.fn(),
      deleteOrganization: jest.fn(),
    },
  },
}));

const api = auth.api as unknown as {
  createInvitation: jest.Mock;
  cancelInvitation: jest.Mock;
  acceptInvitation: jest.Mock;
  createOrganization: jest.Mock;
  updateOrganization: jest.Mock;
  deleteOrganization: jest.Mock;
};

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d5b';
const EMAIL = 'invitee@test.example.com';

interface PrismaStub {
  workspaceInvitation: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
  workspace: { findUnique: jest.Mock; findFirst: jest.Mock };
  user: { findUniqueOrThrow: jest.Mock };
}

function buildService(): {
  service: WorkspaceInvitationService;
  prisma: PrismaStub;
  activityService: { record: jest.Mock };
} {
  const prisma: PrismaStub = {
    workspaceInvitation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Invitee', avatarUrl: null }),
    },
  };
  const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };

  return {
    service: new WorkspaceInvitationService(
      prisma as unknown as PrismaService,
      activityService as unknown as ActivityService,
    ),
    prisma,
    activityService,
  };
}

const request = { headers: {} } as unknown as Request;

/** What Better Auth returns from `createInvitation`, at whatever role it decided on. */
function invitationRow(id: string, role: string) {
  return {
    id,
    email: EMAIL,
    role,
    status: 'pending',
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    organizationId: WORKSPACE_ID,
    inviterId: 'usr_1',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WorkspaceInvitationService.createInvitation', () => {
  it('rejects an OWNER invite before touching Better Auth', async () => {
    const { service } = buildService();

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.OWNER },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(api.createInvitation).not.toHaveBeenCalled();
    expect(api.cancelInvitation).not.toHaveBeenCalled();
  });

  it('creates a first invitation when nothing is pending', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.MEMBER));

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(api.cancelInvitation).not.toHaveBeenCalled();
    expect(result.id).toBe('inv_new');
    expect(result.role).toBe(MemberRole.MEMBER);
    expect(result.acceptUrl).toContain('/invite/inv_new');
  });

  it('resends without revoking when the pending invitation has the same role', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([
      { id: 'inv_old', role: MemberRole.MEMBER },
    ]);
    api.createInvitation.mockResolvedValue(invitationRow('inv_old', MemberRole.MEMBER));

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(api.cancelInvitation).not.toHaveBeenCalled();
    expect(api.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ resend: true }) }),
    );
    expect(result.id).toBe('inv_old');
    expect(result.role).toBe(MemberRole.MEMBER);
    expect(result.acceptUrl).toContain('/invite/inv_old');
  });

  it('revokes and recreates when the pending invitation has a different role', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([
      { id: 'inv_old', role: MemberRole.GUEST },
    ]);
    api.cancelInvitation.mockResolvedValue({ invitation: { id: 'inv_old' } });
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.ADMIN));

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.ADMIN },
      request,
    );

    expect(api.cancelInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ body: { invitationId: 'inv_old' } }),
    );
    // The revoke happens first, so the plugin issues a fresh invitation rather than
    // resending the GUEST one.
    expect(api.cancelInvitation.mock.invocationCallOrder[0]).toBeLessThan(
      api.createInvitation.mock.invocationCallOrder[0] as number,
    );
    expect(api.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ role: MemberRole.ADMIN }) }),
    );

    // The response describes the admin's intent, not the superseded invitation.
    expect(result.role).toBe(MemberRole.ADMIN);
    expect(result.id).toBe('inv_new');
    expect(result.acceptUrl).toContain('/invite/inv_new');
  });

  it('revokes every pending invitation before recreating', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([
      { id: 'inv_a', role: MemberRole.GUEST },
      { id: 'inv_b', role: MemberRole.MEMBER },
    ]);
    api.cancelInvitation.mockResolvedValue({});
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.MEMBER));

    await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(api.cancelInvitation).toHaveBeenCalledTimes(2);
  });

  it('lets a cancelInvitation failure abort the role-change replace instead of proceeding past it', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([
      { id: 'inv_a', role: MemberRole.GUEST },
    ]);
    api.cancelInvitation.mockRejectedValue(
      new APIError('FORBIDDEN', { message: 'not allowed to cancel invitation' }),
    );

    const thrown = await service
      .createInvitation(WORKSPACE_ID, ACTOR_ID, { email: EMAIL, role: MemberRole.MEMBER }, request)
      .catch((error: unknown) => error);

    // If this fell through silently, `createInvitation` would go on to call the plugin with
    // the old invitation still pending — reissuing the same offer twice instead of replacing it.
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(api.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects a plugin response missing a required field instead of returning a half-built invitation', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    // `expiresAt` absent — a shape the plugin should never produce, but the guard exists
    // because "produce a dangling accept link with no expiry" is a worse failure than a 400.
    api.createInvitation.mockResolvedValue({
      id: 'inv_new',
      email: EMAIL,
      role: MemberRole.MEMBER,
      status: 'pending',
      expiresAt: undefined,
    });

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.MEMBER },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * Audit PM-04. The invitation email is sent from inside `auth.api.createInvitation`, by the
   * plugin's own hook, so these cases stand the mock in for that hook: it records a delivery
   * outcome exactly where the real one does, and the assertion is that the outcome survives
   * the trip back to the admin instead of ending in the log.
   */
  it('reports that no email went out when the deployment has no mail transport', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockImplementation(() => {
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
      return Promise.resolve(invitationRow('inv_new', MemberRole.MEMBER));
    });

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(result.emailDelivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
    // The invitation is still created: the accept link is the way in on a deployment without
    // mail, and failing the request would take it away.
    expect(result.id).toBe('inv_new');
    expect(result.acceptUrl).toContain('/invite/inv_new');
  });

  it('reports a refused relay too, not only a missing one', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockImplementation(() => {
      recordMailDelivery(MailDeliveryStatus.FAILED);
      return Promise.resolve(invitationRow('inv_new', MemberRole.MEMBER));
    });

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(result.emailDelivery).toBe(MailDeliveryStatus.FAILED);
  });

  it('reports a delivered invitation as sent', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockImplementation(() => {
      recordMailDelivery(MailDeliveryStatus.SENT);
      return Promise.resolve(invitationRow('inv_new', MemberRole.MEMBER));
    });

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(result.emailDelivery).toBe(MailDeliveryStatus.SENT);
  });

  it('omits the field entirely when no send was observed, rather than guessing', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.MEMBER));

    const result = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    // Absent, not `undefined` and not `SENT`: a client must not be able to read "we did not
    // look" as "it was delivered".
    expect('emailDelivery' in result).toBe(false);
  });

  it('does not leak one invitation delivery outcome into the next', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    api.createInvitation.mockImplementationOnce(() => {
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
      return Promise.resolve(invitationRow('inv_a', MemberRole.MEMBER));
    });
    api.createInvitation.mockImplementationOnce(() =>
      Promise.resolve(invitationRow('inv_b', MemberRole.MEMBER)),
    );

    const first = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );
    const second = await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(first.emailDelivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
    expect('emailDelivery' in second).toBe(false);
  });

  it('looks the pending invitation up by the lower-cased email Better Auth stores', async () => {
    const { service, prisma } = buildService();
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.MEMBER));

    await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: 'Mixed.Case@Test.Example.Com', role: MemberRole.MEMBER },
      request,
    );

    expect(prisma.workspaceInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: 'mixed.case@test.example.com',
          workspaceId: WORKSPACE_ID,
          status: 'pending',
        }),
      }),
    );
  });

  it('reports a conflict rather than the wrong role when the resend races another admin', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);
    // Someone created a GUEST invitation between the lookup and the call, so `resend: true`
    // handed back theirs.
    api.createInvitation.mockResolvedValue(invitationRow('inv_other', MemberRole.GUEST));

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.ADMIN },
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not leak that the email already belongs to a member', async () => {
    const { service } = buildService();
    api.createInvitation.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'User is already a member of this organization',
      }),
    );

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.MEMBER },
        request,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Failed to create invitation',
    });
  });

  it('preserves a 403 from Better Auth instead of flattening it to 400', async () => {
    const { service } = buildService();
    api.createInvitation.mockRejectedValue(
      new APIError('FORBIDDEN', {
        message: 'You are not allowed to invite users to this organization',
      }),
    );

    const thrown = await service
      .createInvitation(WORKSPACE_ID, ACTOR_ID, { email: EMAIL, role: MemberRole.MEMBER }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe(
      'You are not allowed to send this invitation',
    );
  });

  it('lets an unknown failure through to the global filter instead of masking it as 400', async () => {
    const { service } = buildService();
    const failure = new Error('connection terminated unexpectedly');
    api.createInvitation.mockRejectedValue(failure);

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.MEMBER },
        request,
      ),
    ).rejects.toBe(failure);
  });
});

describe('WorkspaceInvitationService invitation error mapping', () => {
  it('maps a 403 from revokeInvitation to 403', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findFirst.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
    });
    api.cancelInvitation.mockRejectedValue(
      new APIError('FORBIDDEN', { message: 'not allowed to cancel invitation' }),
    );

    const thrown = await service
      .revokeInvitation(WORKSPACE_ID, ACTOR_ID, 'inv_1', request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe('Failed to revoke invitation');
  });

  it('404s a revoke for an invitation outside the workspace, before calling Better Auth', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findFirst.mockResolvedValue(null);

    await expect(
      service.revokeInvitation(WORKSPACE_ID, ACTOR_ID, 'inv_missing', request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(api.cancelInvitation).not.toHaveBeenCalled();
  });

  it('maps a 400 from acceptInvitation to 400 with our message', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      status: 'pending',
    });
    api.acceptInvitation.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'Invitation email does not match session email' }),
    );

    const thrown = await service
      .acceptInvitation(WORKSPACE_ID, 'inv_1', request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).message).toBe('Failed to accept invitation');
  });
  it('tells an unverified invitee what to do instead of hiding it behind a generic 403', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      status: 'pending',
    });
    api.acceptInvitation.mockRejectedValue(
      new APIError('FORBIDDEN', {
        message: 'Email verification required before accepting or rejecting invitation',
        code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
      }),
    );

    const thrown = await service
      .acceptInvitation(WORKSPACE_ID, 'inv_1', request)
      .catch((error: unknown) => error);

    // The message is the web client's cue to offer "resend the confirmation email"; it says
    // nothing about anyone but the caller, so being specific here leaks nothing.
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('keeps the 404 the service raised before reaching Better Auth', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

    await expect(
      service.acceptInvitation(WORKSPACE_ID, 'inv_missing', request),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects a plugin response with no member, rather than returning a phantom membership', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      status: 'pending',
    });
    api.acceptInvitation.mockResolvedValue({ member: undefined });

    await expect(service.acceptInvitation(WORKSPACE_ID, 'inv_1', request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

/**
 * An invitation is how access is handed to somebody who has none, so the trail has to cover
 * the whole arc: offered, withdrawn, taken up. These assert the entries and, just as
 * importantly, that a refused call leaves none.
 */
describe('WorkspaceInvitationService audit trail', () => {
  it('records the invitation by id and the role it grants', async () => {
    const { service, activityService } = buildService();
    api.createInvitation.mockResolvedValue(invitationRow('inv_1', MemberRole.ADMIN));

    await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.ADMIN },
      request,
    );

    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.InvitationCreated,
        payload: expect.objectContaining({
          invitationId: 'inv_1',
          role: MemberRole.ADMIN,
        }),
      }),
    );
  });

  it('carries the mail delivery verdict on the entry, not only in the response', async () => {
    const { service, activityService } = buildService();
    api.createInvitation.mockImplementation(() => {
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
      return Promise.resolve(invitationRow('inv_1', MemberRole.MEMBER));
    });

    await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    // An invitation whose mail never left the building was still an offer of access — the
    // link in the response works either way, so the trail has to say which happened.
    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          emailDelivery: MailDeliveryStatus.NOT_CONFIGURED,
        }),
      }),
    );
  });

  it('records nothing when the plugin refuses the invitation', async () => {
    const { service, activityService } = buildService();
    api.createInvitation.mockRejectedValue(
      new APIError('FORBIDDEN', { message: 'not allowed to invite' }),
    );

    await expect(
      service.createInvitation(
        WORKSPACE_ID,
        ACTOR_ID,
        { email: EMAIL, role: MemberRole.MEMBER },
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(activityService.record).not.toHaveBeenCalled();
  });

  it('records a revocation by invitation id', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.workspaceInvitation.findFirst.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      email: EMAIL,
      role: MemberRole.ADMIN,
    });
    api.cancelInvitation.mockResolvedValue({ id: 'inv_1' });

    await service.revokeInvitation(WORKSPACE_ID, ACTOR_ID, 'inv_1', request);

    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: ACTOR_ID,
        type: ActivityType.InvitationRevoked,
        payload: { invitationId: 'inv_1', role: MemberRole.ADMIN },
      }),
    );
  });

  it('records the acceptance against the invitee, who is the one who gained access', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      email: EMAIL,
      status: 'pending',
    });
    api.acceptInvitation.mockResolvedValue({
      member: {
        id: 'member-1',
        userId: 'usr_invitee',
        role: MemberRole.MEMBER,
        organizationId: WORKSPACE_ID,
      },
    });

    await service.acceptInvitation(WORKSPACE_ID, 'inv_1', request);

    // The one audited event whose actor is not an administrator: the invitee is the person
    // whose access changed, and naming the inviter here would misattribute it.
    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: 'usr_invitee',
        type: ActivityType.InvitationAccepted,
        payload: { invitationId: 'inv_1', role: MemberRole.MEMBER },
      }),
    );
  });

  /**
   * The regression guard for the whole section above.
   *
   * `GET /workspaces/:workspaceId/activities` is `@WorkspaceScoped()` and returns `payload`
   * verbatim, while the pending-invitation list is `@WorkspaceRoles(...ADMIN_ROLES)`. An address
   * on any of these payloads would republish the invitation queue to every MEMBER and GUEST —
   * the exact exposure `WorkspaceController.listInvitations` refuses. Asserted over all three
   * events at once, and by value rather than by key, so a future payload cannot smuggle it back
   * under a different name.
   */
  it('never puts an invited address on any invitation payload', async () => {
    const { service, prisma, activityService } = buildService();
    api.createInvitation.mockResolvedValue(invitationRow('inv_1', MemberRole.MEMBER));
    prisma.workspaceInvitation.findFirst.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      email: EMAIL,
      role: MemberRole.MEMBER,
    });
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'inv_1',
      workspaceId: WORKSPACE_ID,
      email: EMAIL,
      status: 'pending',
    });
    api.cancelInvitation.mockResolvedValue({ id: 'inv_1' });
    api.acceptInvitation.mockResolvedValue({
      member: {
        id: 'member-1',
        userId: 'usr_invitee',
        role: MemberRole.MEMBER,
        organizationId: WORKSPACE_ID,
      },
    });

    await service.createInvitation(
      WORKSPACE_ID,
      ACTOR_ID,
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );
    await service.revokeInvitation(WORKSPACE_ID, ACTOR_ID, 'inv_1', request);
    await service.acceptInvitation(WORKSPACE_ID, 'inv_1', request);

    const payloads = activityService.record.mock.calls.map(
      ([, input]: [unknown, { payload: Record<string, unknown> }]) => input.payload,
    );
    expect(payloads).toHaveLength(3);
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain(EMAIL);
      // The id is what makes the address recoverable by a reader who is allowed to see it.
      expect(payload).toHaveProperty('invitationId', 'inv_1');
    }
  });
});

describe('WorkspaceInvitationService.listPendingInvitations', () => {
  /** A stored row as Prisma hands it back, before the service maps it to a DTO. */
  function storedRow(id: string, role: string | null) {
    return {
      id,
      workspaceId: WORKSPACE_ID,
      email: EMAIL,
      role,
      status: 'pending',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    };
  }

  it('asks only for live, pending rows of this workspace, ordered by id', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([storedRow('inv_1', MemberRole.MEMBER)]);

    const page = await service.listPendingInvitations(WORKSPACE_ID, { limit: 100 });

    const args = prisma.workspaceInvitation.findMany.mock.calls[0]?.[0] as {
      where: { workspaceId: string; status: string; expiresAt: { gt: Date } };
      orderBy: { id: string };
      take: number;
    };
    expect(args.where.workspaceId).toBe(WORKSPACE_ID);
    expect(args.where.status).toBe('pending');
    // Expired rows are excluded rather than offered as revocable: revoking one changes nothing.
    expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual({ id: 'asc' });
    // `limit + 1` is the probe that answers `hasMore` without a second count query.
    expect(args.take).toBe(101);
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it('pages by id and reports the cursor the client should continue from', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([
      storedRow('inv_1', MemberRole.MEMBER),
      storedRow('inv_2', MemberRole.ADMIN),
    ]);

    const page = await service.listPendingInvitations(WORKSPACE_ID, { limit: 1 });

    expect(page.items.map((item) => item.id)).toEqual(['inv_1']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('inv_1');
  });

  it('carries the cursor into the query as a keyset bound', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([]);

    await service.listPendingInvitations(WORKSPACE_ID, { limit: 100, cursor: 'inv_1' });

    const args = prisma.workspaceInvitation.findMany.mock.calls[0]?.[0] as {
      where: { id?: { gt: string } };
    };
    expect(args.where.id).toEqual({ gt: 'inv_1' });
  });

  it('rebuilds the accept URL from the id rather than storing a second copy of it', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([storedRow('inv_1', MemberRole.ADMIN)]);

    const page = await service.listPendingInvitations(WORKSPACE_ID, { limit: 100 });

    expect(page.items[0]?.acceptUrl).toContain('inv_1');
    expect(page.items[0]?.role).toBe(MemberRole.ADMIN);
    expect(page.items[0]?.email).toBe(EMAIL);
  });

  it('reads a row with no recorded role as the least privileged one', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceInvitation.findMany.mockResolvedValue([storedRow('inv_1', null)]);

    const page = await service.listPendingInvitations(WORKSPACE_ID, { limit: 100 });

    // Nothing this API writes leaves `role` null, so a null row is not ours — reading it as
    // MEMBER would show an admin a grant the row cannot prove was sent.
    expect(page.items[0]?.role).toBe(MemberRole.GUEST);
  });
});
