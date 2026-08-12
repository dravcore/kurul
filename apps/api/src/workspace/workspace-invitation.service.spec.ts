import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { APIError } from 'better-auth/api';
import type { Request } from 'express';
import { auth } from '../auth/auth';
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
const EMAIL = 'invitee@test.example.com';

interface PrismaStub {
  workspaceInvitation: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
  workspace: { findUnique: jest.Mock; findFirst: jest.Mock };
}

function buildService(): { service: WorkspaceInvitationService; prisma: PrismaStub } {
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
  };

  return {
    service: new WorkspaceInvitationService(prisma as unknown as PrismaService),
    prisma,
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
      service.createInvitation(WORKSPACE_ID, { email: EMAIL, role: MemberRole.OWNER }, request),
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
      { email: EMAIL, role: MemberRole.MEMBER },
      request,
    );

    expect(api.cancelInvitation).toHaveBeenCalledTimes(2);
  });

  it('looks the pending invitation up by the lower-cased email Better Auth stores', async () => {
    const { service, prisma } = buildService();
    api.createInvitation.mockResolvedValue(invitationRow('inv_new', MemberRole.MEMBER));

    await service.createInvitation(
      WORKSPACE_ID,
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
      service.createInvitation(WORKSPACE_ID, { email: EMAIL, role: MemberRole.ADMIN }, request),
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
      service.createInvitation(WORKSPACE_ID, { email: EMAIL, role: MemberRole.MEMBER }, request),
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
      .createInvitation(WORKSPACE_ID, { email: EMAIL, role: MemberRole.MEMBER }, request)
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
      service.createInvitation(WORKSPACE_ID, { email: EMAIL, role: MemberRole.MEMBER }, request),
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
      .revokeInvitation(WORKSPACE_ID, 'inv_1', request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe('Failed to revoke invitation');
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
});
