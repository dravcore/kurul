import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LabelService } from './label.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';

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
      },
    };
    return { service: new LabelService(prisma as unknown as PrismaService), prisma };
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
      service.create(WORKSPACE_ID, BOARD_ID, { name: 'Bug', color: 'slot-2' }),
    ).resolves.toMatchObject({ id: LABEL_ID, color: 'slot-2' });
  });

  it('returns 404 when updating a label outside the workspace', async () => {
    const { service } = buildService();
    await expect(
      service.update(WORKSPACE_ID, LABEL_ID, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes a label after tenant-scoped lookup', async () => {
    const { service, prisma } = buildService();
    prisma.label.findFirst.mockResolvedValue({
      id: LABEL_ID,
      boardId: BOARD_ID,
      name: 'Bug',
      color: 'slot-1',
    });

    await expect(service.remove(WORKSPACE_ID, LABEL_ID)).resolves.toBeUndefined();
    expect(prisma.label.delete).toHaveBeenCalledWith({ where: { id: LABEL_ID } });
  });
});
