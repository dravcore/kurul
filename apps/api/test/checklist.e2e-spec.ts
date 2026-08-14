import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { SocketEvents } from '@kurultay/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Checklists (e2e)', () => {
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

  it("hides another workspace's checklist behind a 404, not a 403", async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const mine = await createWorkspace(owner.agent, 'Mine', 'mine');
    const theirs = await createWorkspace(owner.agent, 'Theirs', 'theirs');
    const { taskId } = await boardWithTask(owner.agent, mine.id);
    const foreignTask = await boardWithTask(owner.agent, theirs.id);
    const foreignId = await createChecklist(
      owner.agent,
      theirs.id,
      foreignTask.taskId,
      'Komşunun listesi',
    );

    // Same signed-in user, so this cannot be answered by authentication: the only thing
    // standing between the caller and the row is the workspace scope on the write.
    await owner.agent
      .patch(`/workspaces/${mine.id}/tasks/${taskId}/checklists/${foreignId}`)
      .send({ title: 'ele geçirildi' })
      .expect(404);

    const row = await prisma.checklist.findUnique({ where: { id: foreignId } });
    expect(row?.title).toBe('Komşunun listesi');
  });

  it("refuses to touch an item through another task's id", async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'TwoTasks', 'twotasks');
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const [first, second] = await Promise.all(
      ['A', 'B'].map((title) =>
        owner.agent
          .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
          .send({ title, columnId: columns.body[0].id })
          .expect(201),
      ),
    );
    const checklistId = await createChecklist(
      owner.agent,
      workspace.id,
      first!.body.id as string,
      'A listesi',
    );
    const withItem = await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${first!.body.id}/checklists/${checklistId}/items`)
      .send({ content: 'madde' })
      .expect(201);
    const itemId = (withItem.body.checklists as Array<{ items: Array<{ id: string }> }>)[0]!
      .items[0]!.id;

    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${second!.body.id}/checklist-items/${itemId}`)
      .send({ isDone: true })
      .expect(404);

    const row = await prisma.checklistItem.findUnique({ where: { id: itemId } });
    expect(row?.isDone).toBe(false);
  });

  it('broadcasts a task update when an item is toggled', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Live', 'live');
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);
    const checklistId = await createChecklist(owner.agent, workspace.id, taskId, 'Canlı');
    const withItem = await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/checklists/${checklistId}/items`)
      .send({ content: 'madde' })
      .expect(201);
    const itemId = (withItem.body.checklists as Array<{ items: Array<{ id: string }> }>)[0]!
      .items[0]!.id;

    const emit = jest.spyOn(realtime, 'emitToBoard');
    emit.mockClear();

    const toggled = await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/checklist-items/${itemId}`)
      .send({ isDone: true })
      .expect(200);

    // No checklist-specific event: a checklist change is a task change, so the board hears
    // the same TASK_UPDATED it hears for a label or an assignee (ADR 0023).
    expect(emit).toHaveBeenCalledWith(
      boardId,
      SocketEvents.TASK_UPDATED,
      expect.objectContaining({ workspaceId: workspace.id, boardId, taskId }),
    );
    expect(toggled.body.checklistSummary).toEqual({ total: 1, done: 1 });
    emit.mockRestore();
  });

  it('does not broadcast for a PATCH that carries no fields', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'NoOp', 'noop');
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const checklistId = await createChecklist(owner.agent, workspace.id, taskId, 'Sessiz');
    const withItem = await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/checklists/${checklistId}/items`)
      .send({ content: 'madde' })
      .expect(201);
    const itemId = (withItem.body.checklists as Array<{ items: Array<{ id: string }> }>)[0]!
      .items[0]!.id;

    const emit = jest.spyOn(realtime, 'emitToBoard');
    emit.mockClear();

    const response = await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/checklist-items/${itemId}`)
      .send({})
      .expect(200);

    // Still the task, so the client has nothing to re-fetch — but nobody else was woken up.
    expect(emit).not.toHaveBeenCalled();
    expect(response.body.id).toBe(taskId);
    expect(response.body.checklistSummary).toEqual({ total: 1, done: 0 });
    emit.mockRestore();
  });

  it('reports 0/0 for a task with no checklist instead of dividing by zero', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Empty', 'empty');
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);

    const detail = await owner.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(200);
    expect(detail.body.checklistSummary).toEqual({ total: 0, done: 0 });
    expect(detail.body.checklists).toEqual([]);

    // An empty checklist counts as zero items, not as one undone thing.
    await createChecklist(owner.agent, workspace.id, taskId, 'Boş');
    const afterEmptyList = await owner.agent
      .get(`/workspaces/${workspace.id}/tasks/${taskId}`)
      .expect(200);
    expect(afterEmptyList.body.checklistSummary).toEqual({ total: 0, done: 0 });

    const listed = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .expect(200);
    // The board list answers the badge without shipping the items themselves.
    expect(listed.body.items[0].checklistSummary).toEqual({ total: 0, done: 0 });
    expect(listed.body.items[0].checklists).toBeNull();
  });

  it('carries done/total onto the board list once items exist', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Badge', 'badge');
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);
    const checklistId = await createChecklist(owner.agent, workspace.id, taskId, 'Rozet');
    const itemUrl = `/workspaces/${workspace.id}/tasks/${taskId}/checklists/${checklistId}/items`;

    await owner.agent.post(itemUrl).send({ content: 'bir' }).expect(201);
    const second = await owner.agent.post(itemUrl).send({ content: 'iki' }).expect(201);
    const items = (second.body.checklists as Array<{ items: Array<{ id: string }> }>)[0]!.items;

    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/checklist-items/${items[0]!.id}`)
      .send({ isDone: true })
      .expect(200);

    const listed = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .expect(200);
    expect(listed.body.items[0].checklistSummary).toEqual({ total: 2, done: 1 });
    expect(listed.body.items[0].checklists).toBeNull();
  });

  it('keeps checklists in position order and reorders them', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Order', 'order');
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const first = await createChecklist(owner.agent, workspace.id, taskId, 'Bir');
    const second = await createChecklist(owner.agent, workspace.id, taskId, 'İki');

    const moved = await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/checklists/${second}/position`)
      .send({})
      .expect(200);

    expect((moved.body.checklists as Array<{ id: string }>).map((list) => list.id)).toEqual([
      second,
      first,
    ]);
  });

  it('takes the checklists with the task when the task is deleted', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Cascade', 'cascade');
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const checklistId = await createChecklist(owner.agent, workspace.id, taskId, 'Silinecek');
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/checklists/${checklistId}/items`)
      .send({ content: 'madde' })
      .expect(201);

    await owner.agent.delete(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(204);

    expect(await prisma.checklist.count({ where: { id: checklistId } })).toBe(0);
    expect(await prisma.checklistItem.count({ where: { checklistId } })).toBe(0);
  });
});
