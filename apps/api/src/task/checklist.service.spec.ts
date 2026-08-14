import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChecklistService } from './checklist.service';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

function build() {
  const prisma = {
    checklist: { findMany: jest.fn(), create: jest.fn() },
  } as unknown as PrismaService;
  const taskRead = {
    findTaskBasic: jest.fn().mockResolvedValue({ id: TASK_ID, boardId: BOARD_ID }),
  } as unknown as TaskReadService;
  const taskEvents = {
    emitUpdated: jest.fn().mockResolvedValue({ id: TASK_ID }),
  } as unknown as TaskEventsService;
  return {
    service: new ChecklistService(prisma, taskRead, taskEvents),
    prisma,
    taskRead,
    taskEvents,
  };
}

describe('ChecklistService.create', () => {
  it('appends after the last checklist and emits a task update', async () => {
    const { service, prisma, taskEvents } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([{ id: 'a', position: 1000 }]);
    (prisma.checklist.create as jest.Mock).mockResolvedValue({ id: 'new' });

    await service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, { title: 'Hazırlık' });

    expect(prisma.checklist.create).toHaveBeenCalledWith({
      data: { taskId: TASK_ID, title: 'Hazırlık', position: 2000 },
    });
    expect(taskEvents.emitUpdated).toHaveBeenCalledWith(WORKSPACE_ID, TASK_ID, ACTOR_ID);
  });

  it('starts the list at the first gap when the task has no checklist yet', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.checklist.create as jest.Mock).mockResolvedValue({ id: 'new' });

    await service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, { title: 'İlk' });

    expect(prisma.checklist.create).toHaveBeenCalledWith({
      data: { taskId: TASK_ID, title: 'İlk', position: 1000 },
    });
  });

  it('does not create anything when the task is outside the workspace', async () => {
    const { service, prisma, taskRead } = build();
    (taskRead.findTaskBasic as jest.Mock).mockRejectedValue(new NotFoundException());

    await expect(service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, { title: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.checklist.create).not.toHaveBeenCalled();
  });
});
