import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChecklistService } from './checklist.service';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const CHECKLIST_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d56';

function build() {
  const prisma = {
    // Transparent transaction: the interactive callback gets the same fake back, so an
    // assertion about which row was written reads the same whether the write happened inside
    // a transaction or not. That is deliberately *not* a test of the transaction — that the
    // lock inside it does any work is proved by `test/checklist.e2e-spec.ts`, which races
    // twenty real requests. The two answer different questions: this one guards what is
    // written, that one guards what happens when writers collide.
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(0),
    checklist: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(
    (fn: (tx: PrismaService) => unknown) => fn(prisma),
  );
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

  it('locks the task row before reading the last position', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.checklist.create as jest.Mock).mockResolvedValue({ id: 'new' });

    await service.create(WORKSPACE_ID, TASK_ID, ACTOR_ID, { title: 'Kilit' });

    const [fragments] = (prisma.$executeRaw as unknown as jest.Mock).mock.calls[0] as [string[]];
    expect(fragments.join('?')).toContain('FOR UPDATE');
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

describe('ChecklistService.update', () => {
  it('scopes the rename through the task relation', async () => {
    const { service, prisma, taskEvents } = build();

    await service.update(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, { title: 'Yeni ad' });

    expect(prisma.checklist.updateMany).toHaveBeenCalledWith({
      where: { id: CHECKLIST_ID, taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
      data: { title: 'Yeni ad' },
    });
    expect(taskEvents.emitUpdated).toHaveBeenCalledWith(WORKSPACE_ID, TASK_ID, ACTOR_ID);
  });

  it('raises not found when the rename matches no row in this tenant', async () => {
    const { service, prisma } = build();
    (prisma.checklist.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(
      service.update(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, { title: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ChecklistService.remove', () => {
  it('scopes the delete through the task relation, not the id alone', async () => {
    const { service, prisma } = build();

    await service.remove(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID);

    expect(prisma.checklist.deleteMany).toHaveBeenCalledWith({
      where: { id: CHECKLIST_ID, taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
    });
  });

  it('raises not found when the checklist belongs to another task', async () => {
    const { service, prisma } = build();
    (prisma.checklist.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(service.remove(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ChecklistService.move', () => {
  it('places the checklist at the midpoint of its new neighbors', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([
      { id: 'a', position: 1000 },
      { id: CHECKLIST_ID, position: 2000 },
      { id: 'c', position: 3000 },
    ]);

    await service.move(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, { afterId: 'c' });

    expect(prisma.checklist.update).toHaveBeenCalledWith({
      where: { id: CHECKLIST_ID },
      data: { position: 4000 },
    });
  });

  it('moves to the front when no afterId is given', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([
      { id: 'a', position: 1000 },
      { id: CHECKLIST_ID, position: 2000 },
    ]);

    await service.move(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, {});

    expect(prisma.checklist.update).toHaveBeenCalledWith({
      where: { id: CHECKLIST_ID },
      data: { position: 0 },
    });
  });

  it('raises not found when the checklist is not on this task', async () => {
    const { service, prisma } = build();
    (prisma.checklist.findMany as jest.Mock).mockResolvedValue([{ id: 'a', position: 1000 }]);

    await expect(service.move(WORKSPACE_ID, TASK_ID, ACTOR_ID, CHECKLIST_ID, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.checklist.update).not.toHaveBeenCalled();
  });
});
