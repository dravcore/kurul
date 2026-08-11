import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
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
  workspaceMember: { findMany: jest.Mock; findUnique: jest.Mock };
}

function buildService(): { service: WorkspaceService; prisma: PrismaStub } {
  const prisma: PrismaStub = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
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
      new APIError('BAD_REQUEST', {
        message: 'Organization already exists',
        code: 'ORGANIZATION_ALREADY_EXISTS',
      }),
    );

    const thrown = await service
      .create('usr_1', { name: 'WS', slug: 'ws' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toBe('Workspace slug already taken');
  });

  // `/organization/update` reports the clash under its own code, not the one `create` uses.
  it('answers 409 when updateOrganization loses the slug race', async () => {
    const { service } = buildService();
    api.updateOrganization.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'Organization slug already taken',
        code: 'ORGANIZATION_SLUG_ALREADY_TAKEN',
      }),
    );

    const thrown = await service
      .update(WORKSPACE_ID, { slug: 'taken' }, request)
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

interface MemberRow {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  user: { name: string; avatarUrl: string | null };
}

/**
 * Ids that sort the way UUIDv7 does: the suffix counts up with join order, so a lexical
 * `id > cursor` walk over these rows is the same walk Postgres does over real ones.
 */
function memberRow(index: number, workspaceId = WORKSPACE_ID): MemberRow {
  const suffix = String(index).padStart(12, '0');
  return {
    id: `0198e2c0-9a1b-7f04-8c3d-${suffix}`,
    workspaceId,
    userId: `user-${suffix}`,
    role: MemberRole.MEMBER,
    user: { name: `Member ${index}`, avatarUrl: null },
  };
}

/** Stands in for Postgres: honours `where.id.gt`, `orderBy id asc` and `take`. */
function stubRoster(prisma: PrismaStub, rows: MemberRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  prisma.workspaceMember.findMany.mockImplementation(
    (args: { where: { workspaceId: string; id?: { gt: string } }; take: number }) => {
      const after = args.where.id?.gt;
      const matching = sorted.filter(
        (row) => row.workspaceId === args.where.workspaceId && (!after || row.id > after),
      );
      return Promise.resolve(matching.slice(0, args.take));
    },
  );
}

describe('WorkspaceService.listMembers', () => {
  it('walks by id and over-fetches one row to answer hasMore', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2), memberRow(3)]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 2 });

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID },
        orderBy: { id: 'asc' },
        take: 3,
      }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.items[1]?.id);
  });

  it('scopes the cursor to the workspace and reads past it', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2)]);
    const cursor = memberRow(1).id;

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50, cursor });

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, id: { gt: cursor } },
      }),
    );
    expect(page.items.map((member) => member.id)).toEqual([memberRow(2).id]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('closes the last page instead of dangling a cursor', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1)]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50 });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  /**
   * The regression this endpoint exists for: the old `take: 1000` returned members 1..1000
   * and silently pretended the rest were not there. Draining the cursor must reach all of
   * them, once each.
   */
  it('reaches every member of a workspace larger than the old 1000-row cap', async () => {
    const { service, prisma } = buildService();
    const total = 1500;
    stubRoster(
      prisma,
      Array.from({ length: total }, (_, index) => memberRow(index + 1)),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: Awaited<ReturnType<typeof service.listMembers>> = await service.listMembers(
        WORKSPACE_ID,
        { limit: 100, cursor },
      );
      seen.push(...page.items.map((member) => member.userId));
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen[0]).toBe(memberRow(1).userId);
    expect(seen[total - 1]).toBe(memberRow(total).userId);
  });

  it('leaves another workspace out of the page', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2, 'other-workspace')]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50 });

    expect(page.items.map((member) => member.workspaceId)).toEqual([WORKSPACE_ID]);
  });
});

describe('WorkspaceService.getMembership', () => {
  it("reads the caller's own row instead of the roster", async () => {
    const { service, prisma } = buildService();
    const row = memberRow(7);
    prisma.workspaceMember.findUnique.mockResolvedValue(row);

    const member = await service.getMembership(WORKSPACE_ID, row.userId);

    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: row.userId } },
      }),
    );
    expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
    expect(member).toEqual({
      id: row.id,
      workspaceId: WORKSPACE_ID,
      userId: row.userId,
      role: MemberRole.MEMBER,
      name: row.user.name,
      avatarUrl: null,
    });
  });

  it('404s when the user is not a member', async () => {
    const { service } = buildService();

    await expect(service.getMembership(WORKSPACE_ID, 'stranger')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
