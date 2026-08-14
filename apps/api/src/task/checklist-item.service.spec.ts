import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChecklistItemService } from './checklist-item.service';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const CHECKLIST_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d56';
const ITEM_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d57';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

function build() {
  const prisma = {
    checklist: { findFirst: jest.fn().mockResolvedValue({ id: CHECKLIST_ID }) },
    checklistItem: {
      findFirst: jest.fn().mockResolvedValue({ checklistId: CHECKLIST_ID }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: ITEM_ID }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const taskRead = {
    findTaskBasic: jest.fn().mockResolvedValue({ id: TASK_ID }),
  } as unknown as TaskReadService;
  const taskEvents = {
    emitUpdated: jest.fn().mockResolvedValue({ id: TASK_ID }),
  } as unknown as TaskEventsService;
  return { service: new ChecklistItemService(prisma, taskRead, taskEvents), prisma, taskEvents };
}

describe('ChecklistItemService', () => {
  it('refuses to add an item to a checklist on another task', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, { content: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.checklistItem.create).not.toHaveBeenCalled();
  });

  it('appends the item after the last one', async () => {
    const { service, prisma } = build();
    (prisma.checklistItem.findMany as jest.Mock).mockResolvedValue([{ id: 'a', position: 3000 }]);

    await service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, {
      content: 'API sözleşmesi',
    });

    expect(prisma.checklistItem.create).toHaveBeenCalledWith({
      data: { checklistId: CHECKLIST_ID, content: 'API sözleşmesi', position: 4000 },
    });
  });

  it('carries the tenant scope two relations deep when toggling', async () => {
    const { service, prisma, taskEvents } = build();

    await service.update(WORKSPACE_ID, TASK_ID, ACTOR_ID, ITEM_ID, { isDone: true });

    expect(prisma.checklistItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: ITEM_ID,
        checklist: { taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
      },
      data: { isDone: true },
    });
    expect(taskEvents.emitUpdated).toHaveBeenCalledWith(WORKSPACE_ID, TASK_ID, ACTOR_ID);
  });

  it('raises not found when the toggle matches no row in this tenant', async () => {
    const { service, prisma } = build();
    (prisma.checklistItem.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(
      service.update(WORKSPACE_ID, TASK_ID, ACTOR_ID, ITEM_ID, { isDone: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('scopes the delete two relations deep as well', async () => {
    const { service, prisma } = build();

    await service.remove(WORKSPACE_ID, TASK_ID, ACTOR_ID, ITEM_ID);

    expect(prisma.checklistItem.deleteMany).toHaveBeenCalledWith({
      where: {
        id: ITEM_ID,
        checklist: { taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
      },
    });
  });

  it('reorders inside the checklist that actually owns the item', async () => {
    const { service, prisma } = build();
    (prisma.checklistItem.findMany as jest.Mock).mockResolvedValue([
      { id: 'a', position: 1000 },
      { id: ITEM_ID, position: 2000 },
      { id: 'c', position: 3000 },
    ]);

    await service.move(WORKSPACE_ID, TASK_ID, ACTOR_ID, ITEM_ID, { afterId: 'a' });

    expect(prisma.checklistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { checklistId: CHECKLIST_ID } }),
    );
    expect(prisma.checklistItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { position: 2000 },
    });
  });
});
