import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { SocketEvents } from '@kurultay/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Realtime emit hooks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let realtime: RealtimeService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    realtime = app.get(RealtimeService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.spyOn(realtime, 'emitToBoard').mockClear();
  });

  it('emits task:created and task:moved after mutations', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Live', `live-${Date.now()}`);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Main' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const todo = columns.body.find((column: { name: string }) => column.name === 'To Do')!;
    const done = columns.body.find((column: { name: string }) => column.name === 'Done')!;

    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Ship it', columnId: todo.id })
      .expect(201);

    expect(realtime.emitToBoard).toHaveBeenCalledWith(
      board.body.id,
      SocketEvents.TASK_CREATED,
      expect.objectContaining({
        workspaceId: workspace.id,
        boardId: board.body.id,
        taskId: task.body.id,
        actorId: expect.any(String),
      }),
    );

    jest.spyOn(realtime, 'emitToBoard').mockClear();

    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${task.body.id}/position`)
      .send({ columnId: done.id })
      .expect(200);

    expect(realtime.emitToBoard).toHaveBeenCalledWith(
      board.body.id,
      SocketEvents.TASK_MOVED,
      expect.objectContaining({
        taskId: task.body.id,
        columnId: done.id,
        boardId: board.body.id,
      }),
    );
  });
});
