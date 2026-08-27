import { PLAN_LIMIT_ERROR, PlanLimitCode } from '@kurul/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { PlanLimitsService } from './plan-limits.service';
import { PLAN_LIMIT_ENV } from './plan-limits';

const VARS = Object.values(PLAN_LIMIT_ENV);

interface Counts {
  members?: number;
  invitations?: number;
  boards?: number;
  workspaces?: number;
  users?: number;
  storedBytes?: number | null;
  override?: unknown;
}

function build(counts: Counts = {}): {
  service: PlanLimitsService;
  prisma: {
    workspace: { findUnique: jest.Mock; count: jest.Mock };
    workspaceMember: { count: jest.Mock };
    workspaceInvitation: { count: jest.Mock };
    board: { count: jest.Mock };
    user: { count: jest.Mock };
    attachment: { aggregate: jest.Mock };
  };
} {
  const prisma = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ planLimits: counts.override ?? null }),
      count: jest.fn().mockResolvedValue(counts.workspaces ?? 0),
    },
    workspaceMember: { count: jest.fn().mockResolvedValue(counts.members ?? 0) },
    workspaceInvitation: { count: jest.fn().mockResolvedValue(counts.invitations ?? 0) },
    board: { count: jest.fn().mockResolvedValue(counts.boards ?? 0) },
    user: { count: jest.fn().mockResolvedValue(counts.users ?? 0) },
    attachment: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { size: counts.storedBytes === undefined ? 0 : counts.storedBytes },
      }),
    },
  };

  const storage = {
    workspaceQuotaBytes: 0,
    instanceQuotaBytes: 0,
  } as unknown as StorageService;

  return {
    service: new PlanLimitsService(prisma as unknown as PrismaService, storage),
    prisma,
  };
}

describe('PlanLimitsService (ADR 0032)', () => {
  beforeEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  describe('unlimited by default', () => {
    it('accepts a workspace on an unconfigured instance without counting anything', async () => {
      const { service, prisma } = build({ workspaces: 9_999 });

      await expect(service.assertWorkspaceAvailable()).resolves.toBeUndefined();
      expect(prisma.workspace.count).not.toHaveBeenCalled();
    });

    it('accepts a board without counting anything', async () => {
      const { service, prisma } = build({ boards: 9_999 });

      await expect(service.assertBoardAvailable('w1')).resolves.toBeUndefined();
      expect(prisma.board.count).not.toHaveBeenCalled();
    });

    it('accepts a seat without counting anything', async () => {
      const { service, prisma } = build({ members: 9_999 });

      await expect(
        service.assertSeatAvailable('w1', { countsInvitations: true }),
      ).resolves.toBeUndefined();
      expect(prisma.workspaceMember.count).not.toHaveBeenCalled();
    });

    it('never refuses a sign-up', async () => {
      const { service, prisma } = build({ users: 9_999 });

      await expect(service.signUpRefusal()).resolves.toBeNull();
      expect(prisma.user.count).not.toHaveBeenCalled();
    });
  });

  describe('seats', () => {
    it('counts members plus invitations still pending', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      const { service, prisma } = build({ members: 7, invitations: 3 });

      await expect(service.assertSeatAvailable('w1', { countsInvitations: true })).rejects.toThrow(
        /no seats left/,
      );
      expect(prisma.workspaceInvitation.count).toHaveBeenCalledWith({
        where: { workspaceId: 'w1', status: 'pending', expiresAt: { gt: expect.any(Date) } },
      });
    });

    it('counts members alone at accept time, so the last seat can be walked into', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      const { service, prisma } = build({ members: 9, invitations: 1 });

      await expect(
        service.assertSeatAvailable('w1', { countsInvitations: false }),
      ).resolves.toBeUndefined();
      expect(prisma.workspaceInvitation.count).not.toHaveBeenCalled();
    });

    it('refuses with the seat code and both numbers', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '2';
      const { service } = build({ members: 2 });

      await expect(
        service.assertSeatAvailable('w1', { countsInvitations: false }),
      ).rejects.toMatchObject({
        response: {
          error: PLAN_LIMIT_ERROR,
          planLimit: { code: PlanLimitCode.Seats, limit: 2, current: 2 },
        },
      });
    });

    it('accepts while there is room', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      const { service } = build({ members: 7, invitations: 2 });

      await expect(
        service.assertSeatAvailable('w1', { countsInvitations: true }),
      ).resolves.toBeUndefined();
    });
  });

  describe('boards', () => {
    it('refuses at the ceiling, with the board code', async () => {
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '3';
      const { service } = build({ boards: 3 });

      await expect(service.assertBoardAvailable('w1')).rejects.toMatchObject({
        response: { planLimit: { code: PlanLimitCode.Boards, limit: 3, current: 3 } },
      });
    });

    it('counts and resolves through the client it is handed, so a transaction stays one snapshot', async () => {
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '3';
      const { service, prisma } = build();
      const tx = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ planLimits: null }) },
        board: { count: jest.fn().mockResolvedValue(1) },
      };

      await expect(service.assertBoardAvailable('w1', tx as never)).resolves.toBeUndefined();
      expect(tx.board.count).toHaveBeenCalledWith({ where: { workspaceId: 'w1' } });
      expect(prisma.board.count).not.toHaveBeenCalled();
    });
  });

  describe('workspaces and accounts', () => {
    it('refuses a workspace at the instance ceiling', async () => {
      process.env[PLAN_LIMIT_ENV.workspaces] = '5';
      const { service } = build({ workspaces: 5 });

      await expect(service.assertWorkspaceAvailable()).rejects.toMatchObject({
        response: { planLimit: { code: PlanLimitCode.Workspaces, limit: 5, current: 5 } },
      });
    });

    it('reports a sign-up refusal as a value, since its caller has no exception filter', async () => {
      process.env[PLAN_LIMIT_ENV.users] = '2';
      const { service } = build({ users: 2 });

      await expect(service.signUpRefusal()).resolves.toEqual({
        code: PlanLimitCode.Users,
        limit: 2,
        current: 2,
      });
    });

    it('does not charge the account ceiling for anonymised accounts', async () => {
      process.env[PLAN_LIMIT_ENV.users] = '2';
      const { service, prisma } = build({ users: 1 });

      await expect(service.signUpRefusal()).resolves.toBeNull();
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    });
  });

  describe('resolution against a workspace override', () => {
    it('prefers the workspace column over the instance environment', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      const { service } = build({ members: 3, override: { seats: 3 } });

      await expect(
        service.assertSeatAvailable('w1', { countsInvitations: false }),
      ).rejects.toMatchObject({
        response: { planLimit: { code: PlanLimitCode.Seats, limit: 3, current: 3 } },
      });
    });

    it('lets one workspace be unlimited while the instance has a ceiling', async () => {
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '1';
      const { service } = build({ boards: 40, override: { boards: null } });

      await expect(service.assertBoardAvailable('w1')).resolves.toBeUndefined();
    });

    it('answers the attachment quota in the byte spelling the upload path speaks', async () => {
      const { service } = build({ override: { storageBytes: 4096 } });

      await expect(service.workspaceStorageQuotaBytes('w1')).resolves.toBe(4096);
    });

    it('answers 0 bytes, the quota spelling of unlimited, when nothing caps storage', async () => {
      const { service } = build();

      await expect(service.workspaceStorageQuotaBytes('w1')).resolves.toBe(0);
    });
  });

  describe('the usage read', () => {
    it('reports the resolved ceilings beside what is in use', async () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '4';
      const { service } = build({ members: 6, invitations: 1, boards: 2, storedBytes: 1_024 });

      await expect(service.plan('w1')).resolves.toEqual({
        limits: { seats: 10, boards: 4, storageBytes: null },
        usage: { seats: 7, boards: 2, storageBytes: 1_024 },
      });
    });

    it('reads a workspace with no attachments as zero bytes rather than null', async () => {
      const { service } = build({ storedBytes: null });

      await expect(service.plan('w1')).resolves.toMatchObject({ usage: { storageBytes: 0 } });
    });
  });
});
