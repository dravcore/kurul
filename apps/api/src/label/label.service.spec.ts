import { NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { LabelService } from './label.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d56';

describe('LabelService', () => {
  function buildService() {
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID, workspaceId: WORKSPACE_ID }),
      },
      label: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    // The default transaction hands the same mock back as `tx`, so assertions on
    // `prisma.label.*` also cover the calls the service makes inside the transaction.
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };
    return {
      service: new LabelService(
        prisma as unknown as PrismaService,
        activityService as unknown as ActivityService,
      ),
      prisma,
      activityService,
    };
  }

  it('lists labels for a board in the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.label.findMany.mockResolvedValue([
      { id: LABEL_ID, boardId: BOARD_ID, name: 'Bug', color: 'slot-1' },
    ]);

    await expect(service.list(WORKSPACE_ID, BOARD_ID)).resolves.toEqual([
      { id: LABEL_ID, boardId: BOARD_ID, name: 'Bug', color: 'slot-1' },
    ]);
  });

  it('creates a label on the board', async () => {
    const { service, prisma } = buildService();
    prisma.label.create.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-2',
    });

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Bug', color: 'slot-2' }),
    ).resolves.toMatchObject({ id: LABEL_ID, color: 'slot-2' });
  });

  it('records the label creation against the actor', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.label.create.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-2',
    });

    await service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Bug', color: 'slot-2' });

    expect(activityService.record).toHaveBeenCalledWith(prisma, {
      workspaceId: WORKSPACE_ID,
      userId: ACTOR_ID,
      type: ActivityType.LabelCreated,
      payload: { labelId: LABEL_ID, boardId: BOARD_ID, name: 'Bug', color: 'slot-2' },
    });
  });

  it('records a label deletion before the row is gone', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.label.findFirst.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Security',
      color: 'slot-3',
    });

    await service.remove(WORKSPACE_ID, LABEL_ID, ACTOR_ID);

    expect(activityService.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.LabelDeleted,
        payload: { labelId: LABEL_ID, boardId: BOARD_ID, name: 'Security', color: 'slot-3' },
      }),
    );
    expect(activityService.record.mock.invocationCallOrder[0]!).toBeLessThan(
      prisma.label.deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('returns 404 when updating a label outside the workspace', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.update(WORKSPACE_ID, LABEL_ID, ACTOR_ID, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.label.update).not.toHaveBeenCalled();
  });

  it('carries the tenant scope on the update predicate, not just the check', async () => {
    const { service, prisma } = buildService();
    prisma.label.findFirst.mockResolvedValue({ id: LABEL_ID });
    prisma.label.update.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Renamed',
      color: 'slot-1',
    });

    await service.update(WORKSPACE_ID, LABEL_ID, ACTOR_ID, { name: 'Renamed' });

    expect(prisma.label.update).toHaveBeenCalledWith({
      where: { id: LABEL_ID, board: { workspaceId: WORKSPACE_ID } },
      data: { name: 'Renamed' },
    });
  });

  it('updates only the color, leaving the name field out of the write entirely', async () => {
    const { service, prisma } = buildService();
    prisma.label.findFirst.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-1',
    });
    prisma.label.update.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-4',
    });

    await service.update(WORKSPACE_ID, LABEL_ID, ACTOR_ID, { color: 'slot-4' } as never);

    // Not `data: { name: undefined, color: 'slot-4' }` — an explicit `undefined` key would
    // still overwrite the column with Prisma's own semantics for some drivers, so the branch
    // has to omit the key rather than null it out.
    expect(prisma.label.update).toHaveBeenCalledWith({
      where: { id: LABEL_ID, board: { workspaceId: WORKSPACE_ID } },
      data: { color: 'slot-4' },
    });
  });

  it('updates both fields together in a single write', async () => {
    const { service, prisma } = buildService();
    prisma.label.findFirst.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-1',
    });
    prisma.label.update.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Renamed',
      color: 'slot-5',
    });

    await service.update(WORKSPACE_ID, LABEL_ID, ACTOR_ID, {
      name: 'Renamed',
      color: 'slot-5',
    } as never);

    expect(prisma.label.update).toHaveBeenCalledWith({
      where: { id: LABEL_ID, board: { workspaceId: WORKSPACE_ID } },
      data: { name: 'Renamed', color: 'slot-5' },
    });
  });

  it('removes a label after tenant-scoped lookup', async () => {
    const { service, prisma } = buildService();
    prisma.label.findFirst.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-1',
    });

    await expect(service.remove(WORKSPACE_ID, LABEL_ID, ACTOR_ID)).resolves.toBeUndefined();
    // The delete predicate carries the tenant scope (label → board → workspace), not just the id.
    expect(prisma.label.deleteMany).toHaveBeenCalledWith({
      where: { id: LABEL_ID, board: { workspaceId: WORKSPACE_ID } },
    });
    expect(prisma.label.delete).not.toHaveBeenCalled();
  });

  it('returns 404 and writes nothing when removing a label outside the workspace', async () => {
    const { service, prisma } = buildService();

    await expect(service.remove(WORKSPACE_ID, LABEL_ID, ACTOR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.label.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the scoped label delete matches no row', async () => {
    const { service, prisma } = buildService();
    // The row passed the in-transaction check but its board left the workspace before the
    // write — the scoped predicate is what catches it, and 404 is the cross-tenant answer.
    prisma.label.findFirst.mockResolvedValue({ id: LABEL_ID });
    prisma.label.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(WORKSPACE_ID, LABEL_ID, ACTOR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
