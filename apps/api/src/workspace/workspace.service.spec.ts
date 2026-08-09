import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import type { Request } from 'express';
import { auth } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from './workspace.service';

// `auth.ts` opens a Postgres pool and demands DATABASE_URL / BETTER_AUTH_SECRET at import
// time, so the whole module is replaced — these tests are about what the service does with
// the plugin's answers, not about the plugin.
jest.mock('../auth/auth', () => ({
  auth: {
    api: {
      createOrganization: jest.fn(),
      updateOrganization: jest.fn(),
      deleteOrganization: jest.fn(),
    },
  },
}));

const api = auth.api as unknown as {
  createOrganization: jest.Mock;
  updateOrganization: jest.Mock;
  deleteOrganization: jest.Mock;
};

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
interface PrismaStub {
  workspace: { findUnique: jest.Mock; findFirst: jest.Mock };
  workspaceMember: { findMany: jest.Mock };
}

function buildService(): { service: WorkspaceService; prisma: PrismaStub } {
  const prisma: PrismaStub = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  return {
    service: new WorkspaceService(prisma as unknown as PrismaService),
    prisma,
  };
}

const request = { headers: {} } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WorkspaceService Better Auth error mapping', () => {
  it('maps a 401 from createOrganization to 401, not 400', async () => {
    const { service } = buildService();
    api.createOrganization.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'session expired at handler 12' }),
    );

    const thrown = await service
      .create('usr_1', { name: 'WS', slug: 'ws' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).message).toBe('Failed to create workspace');
  });

  it('still answers 409 when Better Auth loses the slug race', async () => {
    const { service } = buildService();
    api.createOrganization.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'Organization already exists' }),
    );

    const thrown = await service
      .create('usr_1', { name: 'WS', slug: 'ws' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toBe('Workspace slug already taken');
  });

  it('maps a 404 from updateOrganization to 404', async () => {
    const { service } = buildService();
    api.updateOrganization.mockRejectedValue(
      new APIError('NOT_FOUND', { message: 'organization row missing' }),
    );

    const thrown = await service
      .update(WORKSPACE_ID, { name: 'Renamed' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as NotFoundException).message).toBe('Workspace not found');
  });

  it('rethrows an unknown failure from deleteOrganization', async () => {
    const { service } = buildService();
    const failure = new Error('pool drained');
    api.deleteOrganization.mockRejectedValue(failure);

    await expect(service.remove(WORKSPACE_ID, request)).rejects.toBe(failure);
  });
});

describe('WorkspaceService.listMembers', () => {
  it('caps the query with a hard take limit', async () => {
    const { service, prisma } = buildService();

    await service.listMembers(WORKSPACE_ID);

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID }, take: 1000 }),
    );
  });
});
