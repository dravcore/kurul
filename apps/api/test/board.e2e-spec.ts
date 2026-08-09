import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Boards and columns (e2e)', () => {
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

  it('creates a board with default columns and lists them ordered by position', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Boards', `boards-${Date.now()}`);

    const created = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Product', description: 'Ship it' })
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'Product',
      description: 'Ship it',
      workspaceId: workspace.id,
    });

    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${created.body.id}/columns`)
      .expect(200);

    expect(columns.body.map((column: { name: string; position: number }) => column.name)).toEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
    expect(columns.body.map((column: { position: number }) => column.position)).toEqual([
      1000, 2000, 3000,
    ]);
  });

  it('returns 404 for cross-tenant board and column access', async () => {
    const ownerA = await signUp(app, { name: 'Owner A' });
    const ownerB = await signUp(app, { name: 'Owner B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'A', `a-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'B', `b-${Date.now()}`);

    const boardA = await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/boards`)
      .send({ name: 'A Board' })
      .expect(201);

    const columnsA = await ownerA.agent
      .get(`/workspaces/${workspaceA.id}/boards/${boardA.body.id}/columns`)
      .expect(200);

    await ownerB.agent.get(`/workspaces/${workspaceA.id}/boards/${boardA.body.id}`).expect(404);
    await ownerB.agent.get(`/workspaces/${workspaceB.id}/boards/${boardA.body.id}`).expect(404);
    await ownerB.agent
      .patch(`/workspaces/${workspaceB.id}/columns/${columnsA.body[0].id}`)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('enforces the ADR 0009 role matrix for boards and columns', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const admin = await signUp(app, { name: 'Admin' });
    const member = await signUp(app, { name: 'Member' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'Roles', `roles-${Date.now()}`);

    const adminMe = await admin.agent.get('/me').expect(200);
    const memberMe = await member.agent.get('/me').expect(200);
    const guestMe = await guest.agent.get('/me').expect(200);

    await addMember(prisma, workspace.id, adminMe.body.id as string, MemberRole.ADMIN);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    await addMember(prisma, workspace.id, guestMe.body.id as string, MemberRole.GUEST);

    const board = await member.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Member Board' })
      .expect(201);

    await member.agent
      .patch(`/workspaces/${workspace.id}/boards/${board.body.id}`)
      .send({ name: 'Renamed' })
      .expect(200);

    await guest.agent.get(`/workspaces/${workspace.id}/boards`).expect(200);
    await guest.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Guest Board' })
      .expect(403);

    await member.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .send({ name: 'Blocked' })
      .expect(403);

    const column = await admin.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .send({ name: 'Review' })
      .expect(201);

    await admin.agent
      .patch(`/workspaces/${workspace.id}/columns/${column.body.id}`)
      .send({ name: 'In Review' })
      .expect(200);

    await member.agent.delete(`/workspaces/${workspace.id}/boards/${board.body.id}`).expect(403);
    await admin.agent.delete(`/workspaces/${workspace.id}/boards/${board.body.id}`).expect(204);
  });

  it('reorders a column between neighbors without rewriting siblings', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Order', `order-${Date.now()}`);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Ordered' })
      .expect(201);

    const listed = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);

    const [todo, inProgress, done] = listed.body as Array<{
      id: string;
      name: string;
      position: number;
    }>;

    const moved = await owner.agent
      .patch(`/workspaces/${workspace.id}/columns/${done.id}/position`)
      .send({ beforeColumnId: todo.id, afterColumnId: inProgress.id })
      .expect(200);

    expect(moved.body.position).toBeGreaterThan(todo.position);
    expect(moved.body.position).toBeLessThan(inProgress.position);

    const afterMove = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);

    expect(afterMove.body.map((column: { name: string }) => column.name)).toEqual([
      'To Do',
      'Done',
      'In Progress',
    ]);
    expect(afterMove.body.find((column: { id: string }) => column.id === todo.id)?.position).toBe(
      todo.position,
    );
    expect(
      afterMove.body.find((column: { id: string }) => column.id === inProgress.id)?.position,
    ).toBe(inProgress.position);
  });

  it('cascades column delete to tasks', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Cascade', `cascade-${Date.now()}`);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Cascade Board' })
      .expect(201);

    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const todo = columns.body[0] as { id: string };

    const me = await owner.agent.get('/me').expect(200);

    await prisma.task.create({
      data: {
        boardId: board.body.id as string,
        columnId: todo.id,
        title: 'Will vanish',
        position: 1000,
        createdById: me.body.id as string,
      },
    });

    await owner.agent.delete(`/workspaces/${workspace.id}/columns/${todo.id}`).expect(204);

    const remainingTasks = await prisma.task.count({
      where: { boardId: board.body.id as string },
    });
    expect(remainingTasks).toBe(0);
  });
});
