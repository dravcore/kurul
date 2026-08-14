import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Checklists (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function boardWithTask(
    agent: TestUser['agent'],
    workspaceId: string,
  ): Promise<{ boardId: string; taskId: string }> {
    const board = await agent
      .post(`/workspaces/${workspaceId}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await agent
      .get(`/workspaces/${workspaceId}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await agent
      .post(`/workspaces/${workspaceId}/boards/${board.body.id}/tasks`)
      .send({ title: 'Card', columnId: columns.body[0].id })
      .expect(201);
    return { boardId: board.body.id as string, taskId: task.body.id as string };
  }

  async function createChecklist(
    agent: TestUser['agent'],
    workspaceId: string,
    taskId: string,
    title: string,
  ): Promise<string> {
    const response = await agent
      .post(`/workspaces/${workspaceId}/tasks/${taskId}/checklists`)
      .send({ title })
      .expect(201);
    const created = (response.body.checklists as Array<{ id: string; title: string }>).find(
      (list) => list.title === title,
    );
    if (!created) throw new Error(`checklist "${title}" missing from the response`);
    return created.id;
  }

  it('gives 20 concurrently added items 20 distinct positions', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Race', 'race');
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const checklistId = await createChecklist(owner.agent, workspace.id, taskId, 'Yarış');

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        owner.agent
          .post(`/workspaces/${workspace.id}/tasks/${taskId}/checklists/${checklistId}/items`)
          .send({ content: `madde ${index}` })
          .expect(201),
      ),
    );

    const rows = await prisma.checklistItem.findMany({
      where: { checklistId },
      select: { position: true },
    });
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => row.position)).size).toBe(20);
  });

  it('gives 10 concurrently added checklists 10 distinct positions', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'ListRace', 'listrace');
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        owner.agent
          .post(`/workspaces/${workspace.id}/tasks/${taskId}/checklists`)
          .send({ title: `liste ${index}` })
          .expect(201),
      ),
    );

    const rows = await prisma.checklist.findMany({ where: { taskId }, select: { position: true } });
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.position)).size).toBe(10);
  });
});
