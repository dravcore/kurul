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

  describe('completion follows the column category, not the column name', () => {
    const today = (): string => new Date().toISOString().slice(0, 10);

    /** Owner, workspace and a board with its three seeded columns. */
    async function setUpBoard() {
      const owner = await signUp(app, { name: 'Owner' });
      const workspace = await createWorkspace(owner.agent, 'Dash', `dash-${Date.now()}`);
      const board = await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'Main' })
        .expect(201);
      const columns = await owner.agent
        .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
        .expect(200);
      const byName = (name: string): { id: string; name: string; category: string } =>
        columns.body.find((column: { name: string }) => column.name === name);
      return { owner, workspace, boardId: board.body.id as string, byName };
    }

    async function createTask(
      owner: Awaited<ReturnType<typeof setUpBoard>>['owner'],
      workspaceId: string,
      boardId: string,
      columnId: string,
    ): Promise<string> {
      const task = await owner.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/tasks`)
        .send({ title: 'Work', columnId })
        .expect(201);
      return task.body.id as string;
    }

    async function completedToday(
      owner: Awaited<ReturnType<typeof setUpBoard>>['owner'],
      workspaceId: string,
    ): Promise<number> {
      const summary = await owner.agent
        .get(`/workspaces/${workspaceId}/dashboard/summary`)
        .expect(200);
      return summary.body.throughput.find((row: { date: string }) => row.date === today())
        .completed as number;
    }

    it('seeds each default column with its category', async () => {
      const { byName } = await setUpBoard();

      expect(byName('To Do').category).toBe('UNSTARTED');
      expect(byName('In Progress').category).toBe('STARTED');
      expect(byName('Done').category).toBe('COMPLETED');
    });

    it('keeps counting completions after the Done column is renamed', async () => {
      // The live defect ADR 0019 closes: this renamed board reported zero completions.
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const taskId = await createTask(owner, workspace.id, boardId, byName('To Do').id);
      const done = byName('Done');

      await owner.agent
        .patch(`/workspaces/${workspace.id}/columns/${done.id}`)
        .send({ name: 'Shipped' })
        .expect(200);
      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: done.id })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(1);
    });

    it('counts a completed column whose name is not English', async () => {
      // ADR 0018 seeds column names in the creator's locale; "Bitti" must count as done.
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const bitti = await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .send({ name: 'Bitti', category: 'COMPLETED' })
        .expect(201);
      const taskId = await createTask(owner, workspace.id, boardId, byName('To Do').id);

      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: bitti.body.id })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(1);
    });

    it('does not count a column merely named Done', async () => {
      // The inverse of the same rule, and the reason the name predicate had to be deleted
      // rather than kept as a fallback.
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const decoy = await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .send({ name: 'Done' })
        .expect(201);
      expect(decoy.body.category).toBe('UNSTARTED');
      const taskId = await createTask(owner, workspace.id, boardId, byName('To Do').id);

      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: decoy.body.id })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(0);
    });

    it('counts moves into every completed column, not just the first', async () => {
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const wontDo = await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .send({ name: "Won't Do", category: 'COMPLETED' })
        .expect(201);
      const first = await createTask(owner, workspace.id, boardId, byName('To Do').id);
      const second = await createTask(owner, workspace.id, boardId, byName('To Do').id);

      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${first}/position`)
        .send({ columnId: byName('Done').id })
        .expect(200);
      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${second}/position`)
        .send({ columnId: wontDo.body.id })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(2);
    });

    it('retroactively counts moves once a column is marked completed', async () => {
      // This is what makes the column-settings UI a repair and not just a fix going forward:
      // the id branch of the predicate resolves against the column's category *now*.
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const shipped = await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .send({ name: 'Shipped' })
        .expect(201);
      const taskId = await createTask(owner, workspace.id, boardId, byName('To Do').id);
      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: shipped.body.id })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(0);

      await owner.agent
        .patch(`/workspaces/${workspace.id}/columns/${shipped.body.id}`)
        .send({ category: 'COMPLETED' })
        .expect(200);

      await expect(completedToday(owner, workspace.id)).resolves.toBe(1);
    });

    it('still counts a move into a completed column that was later deleted', async () => {
      // The case the deleted name fallback used to serve. The activity payload's
      // `toColumnCategory` snapshot is what carries it now — and unlike the name, it carries
      // it in every language.
      const { owner, workspace, boardId, byName } = await setUpBoard();
      const taskId = await createTask(owner, workspace.id, boardId, byName('To Do').id);
      const done = byName('Done');

      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: done.id })
        .expect(200);
      // The column must be empty before it can be deleted.
      await owner.agent
        .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
        .send({ columnId: byName('To Do').id })
        .expect(200);
      await owner.agent.delete(`/workspaces/${workspace.id}/columns/${done.id}`).expect(204);

      // The move into Done survives; the move back out of it was never a completion.
      await expect(completedToday(owner, workspace.id)).resolves.toBe(1);
    });

    it('rejects a category the enum does not define', async () => {
      const { owner, workspace, boardId } = await setUpBoard();

      await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .send({ name: 'Nope', category: 'FINISHED' })
        .expect(400);
    });
  });
});
