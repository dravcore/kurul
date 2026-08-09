import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MemberRole } from '@kurultay/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Dashboard (e2e)', () => {
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

  it('aggregates workspace and board-scoped summaries', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Dash', `dash-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);

    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Main' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const todo = columns.body.find((column: { name: string }) => column.name === 'To Do')!;

    const high = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Urgent fix', columnId: todo.id })
      .expect(201);
    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${high.body.id}`)
      .send({ priority: 'HIGH', dueDate: '2020-01-01T00:00:00.000Z' })
      .expect(200);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${high.body.id}/assignees`)
      .send({ userId: memberMe.body.id })
      .expect(201);

    await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Backlog', columnId: todo.id })
      .expect(201);

    const summary = await owner.agent
      .get(`/workspaces/${workspace.id}/dashboard/summary`)
      .expect(200);

    expect(summary.body.totalTasks).toBe(2);
    expect(summary.body.overdueCount).toBe(1);
    expect(summary.body.byColumn).toBeNull();
    expect(
      summary.body.byPriority.find((row: { priority: string }) => row.priority === 'HIGH'),
    ).toEqual({ priority: 'HIGH', count: 1 });
    expect(summary.body.byAssignee.some((row: { name: string }) => row.name === 'Unassigned')).toBe(
      true,
    );
    expect(
      summary.body.byAssignee.some((row: { userId: string }) => row.userId === memberMe.body.id),
    ).toBe(true);

    const boardSummary = await owner.agent
      .get(`/workspaces/${workspace.id}/dashboard/summary?boardId=${board.body.id}`)
      .expect(200);
    expect(boardSummary.body.byColumn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'To Do', count: 2 }),
        expect.objectContaining({ name: 'Done', count: 0 }),
      ]),
    );

    expect(summary.body.throughput).toHaveLength(14);
    const today = new Date().toISOString().slice(0, 10);
    expect(summary.body.throughput.find((row: { date: string }) => row.date === today)).toEqual(
      expect.objectContaining({ date: today, created: 2, completed: 0 }),
    );

    const done = columns.body.find((column: { name: string }) => column.name === 'Done')!;
    await owner.agent
      .patch(`/workspaces/${workspace.id}/tasks/${high.body.id}/position`)
      .send({ columnId: done.id })
      .expect(200);

    const afterMove = await owner.agent
      .get(`/workspaces/${workspace.id}/dashboard/summary`)
      .expect(200);
    expect(afterMove.body.throughput.find((row: { date: string }) => row.date === today)).toEqual(
      expect.objectContaining({ date: today, created: 2, completed: 1 }),
    );

    const other = await createWorkspace(owner.agent, 'Other', `other-${Date.now()}`);
    const foreignBoard = await owner.agent
      .post(`/workspaces/${other.id}/boards`)
      .send({ name: 'Foreign' })
      .expect(201);
    await owner.agent
      .get(`/workspaces/${workspace.id}/dashboard/summary?boardId=${foreignBoard.body.id}`)
      .expect(404);

    const anonymous = request(app.getHttpServer());
    await anonymous.get(`/workspaces/${workspace.id}/dashboard/summary`).expect(401);
  });
});
