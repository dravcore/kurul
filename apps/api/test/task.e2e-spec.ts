import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Tasks (e2e)', () => {
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

  async function boardWithColumns(
    agent: Awaited<ReturnType<typeof signUp>>['agent'],
    workspaceId: string,
  ): Promise<{ boardId: string; columns: Array<{ id: string; name: string }> }> {
    const board = await agent
      .post(`/workspaces/${workspaceId}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await agent
      .get(`/workspaces/${workspaceId}/boards/${board.body.id}/columns`)
      .expect(200);
    return { boardId: board.body.id as string, columns: columns.body };
  }

  it('covers the fractional-index positioning matrix', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tasks', `tasks-${Date.now()}`);
    const { boardId, columns } = await boardWithColumns(owner.agent, workspace.id);
    const todo = columns.find((column) => column.name === 'To Do')!;
    const doing = columns.find((column) => column.name === 'In Progress')!;

    const first = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'First', columnId: todo.id })
      .expect(201);
    expect(first.body.position).toBe(1000);

    const third = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Third', columnId: todo.id })
      .expect(201);
    expect(third.body.position).toBeGreaterThan(first.body.position as number);

    const second = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Second', columnId: todo.id, afterTaskId: first.body.id })
      .expect(201);
    expect(second.body.position).toBeGreaterThan(first.body.position as number);
    expect(second.body.position).toBeLessThan(third.body.position as number);

    // Move third to top: afterTaskId = current first among remaining → insertionIndex 0
    const toTop = await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${third.body.id}/position`)
      .send({ columnId: todo.id, afterTaskId: first.body.id })
      .expect(200);

    const listed = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .expect(200);
    const todoTasks = (listed.body as Array<{ id: string; columnId: string; position: number }>)
      .filter((task) => task.columnId === todo.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    expect(todoTasks[0]!.id).toBe(toTop.body.id);
    expect(todoTasks[0]!.position).toBeLessThan(todoTasks[1]!.position);

    const beforeCross = await prisma.task.findMany({ where: { boardId } });
    const cross = await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${second.body.id}/position`)
      .send({ columnId: doing.id })
      .expect(200);
    expect(cross.body.columnId).toBe(doing.id);
    const afterCross = await prisma.task.findMany({ where: { boardId } });
    for (const task of afterCross.filter((row) => row.id !== second.body.id)) {
      const prior = beforeCross.find((row) => row.id === task.id)!;
      expect(task.columnId).toBe(prior.columnId);
      expect(task.position).toBe(prior.position);
    }

    const anchor = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Anchor', columnId: doing.id })
      .expect(201);
    const beforeSame = await prisma.task.findMany({ where: { columnId: doing.id } });
    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${cross.body.id}/position`)
      .send({ columnId: doing.id, afterTaskId: anchor.body.id })
      .expect(200);
    const afterSame = await prisma.task.findMany({ where: { columnId: doing.id } });
    for (const task of afterSame.filter((row) => row.id !== cross.body.id)) {
      const prior = beforeSame.find((row) => row.id === task.id)!;
      expect(task.position).toBe(prior.position);
    }

    let afterId = first.body.id as string;
    for (let i = 0; i < 40; i += 1) {
      const created = await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
        .send({ title: `Gap ${i}`, columnId: todo.id, afterTaskId: afterId })
        .expect(201);
      afterId = created.body.id as string;
    }

    const finalTodo = (
      (await owner.agent.get(`/workspaces/${workspace.id}/boards/${boardId}/tasks`).expect(200))
        .body as Array<{ id: string; columnId: string; position: number }>
    )
      .filter((task) => task.columnId === todo.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

    for (let i = 1; i < finalTodo.length; i += 1) {
      expect(finalTodo[i]!.position).toBeGreaterThan(finalTodo[i - 1]!.position);
    }
  });

  it('returns 404 for cross-tenant access and 422 for cross-board column', async () => {
    const ownerA = await signUp(app, { name: 'A' });
    const ownerB = await signUp(app, { name: 'B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'A', `a-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'B', `b-${Date.now()}`);
    const a = await boardWithColumns(ownerA.agent, workspaceA.id);
    await boardWithColumns(ownerB.agent, workspaceB.id);

    const task = await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/boards/${a.boardId}/tasks`)
      .send({ title: 'Secret', columnId: a.columns[0]!.id })
      .expect(201);

    await ownerB.agent.get(`/workspaces/${workspaceA.id}/tasks/${task.body.id}`).expect(404);
    await ownerB.agent.get(`/workspaces/${workspaceB.id}/tasks/${task.body.id}`).expect(404);

    const otherBoard = await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/boards`)
      .send({ name: 'Other' })
      .expect(201);
    const otherColumns = await ownerA.agent
      .get(`/workspaces/${workspaceA.id}/boards/${otherBoard.body.id}/columns`)
      .expect(200);

    await ownerA.agent
      .patch(`/workspaces/${workspaceA.id}/tasks/${task.body.id}/position`)
      .send({ columnId: otherColumns.body[0].id })
      .expect(422);
  });

  it('enforces ADR 0010 role matrix for tasks', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'Roles', `roles-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    const guestMe = await guest.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    await addMember(prisma, workspace.id, guestMe.body.id as string, MemberRole.GUEST);
    const { boardId, columns } = await boardWithColumns(owner.agent, workspace.id);
    const columnId = columns[0]!.id;

    const created = await member.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Member task', columnId })
      .expect(201);

    await member.agent
      .patch(`/workspaces/${workspace.id}/tasks/${created.body.id}`)
      .send({ title: 'Updated' })
      .expect(200);

    await member.agent
      .patch(`/workspaces/${workspace.id}/tasks/${created.body.id}/position`)
      .send({ columnId: columns[1]!.id })
      .expect(200);

    await guest.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Nope', columnId })
      .expect(403);

    await guest.agent.get(`/workspaces/${workspace.id}/boards/${boardId}/tasks`).expect(200);

    await member.agent.delete(`/workspaces/${workspace.id}/tasks/${created.body.id}`).expect(204);
  });
});
