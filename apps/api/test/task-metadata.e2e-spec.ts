import { INestApplication } from '@nestjs/common';
import { LabelColorSlot, MemberRole, Priority } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Task metadata (e2e)', () => {
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
    agent: Awaited<ReturnType<typeof signUp>>['agent'],
    workspaceId: string,
  ) {
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
    return {
      boardId: board.body.id as string,
      taskId: task.body.id as string,
      columns: columns.body as Array<{ id: string }>,
    };
  }

  it('covers labels, assignees, comments, and metadata fields', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Meta', `meta-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);

    const label = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'backend', color: LabelColorSlot['slot-1'] })
      .expect(201);
    expect(label.body.color).toBe('slot-1');

    await member.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'nope', color: LabelColorSlot['slot-2'] })
      .expect(403);

    const listed = await member.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .expect(200);
    expect(listed.body).toHaveLength(1);

    const patched = await owner.agent
      .patch(`/workspaces/${workspace.id}/labels/${label.body.id}`)
      .send({ name: 'api', color: LabelColorSlot['slot-3'] })
      .expect(200);
    expect(patched.body).toMatchObject({ name: 'api', color: 'slot-3' });

    const withLabel = await member.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/labels`)
      .send({ labelId: label.body.id })
      .expect(201);
    expect(withLabel.body.labels).toEqual([
      expect.objectContaining({ id: label.body.id, name: 'api', color: 'slot-3' }),
    ]);

    await member.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/labels`)
      .send({ labelId: label.body.id })
      .expect(409);

    const withAssignee = await member.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: memberMe.body.id })
      .expect(201);
    expect(withAssignee.body.assignees).toEqual([
      expect.objectContaining({ userId: memberMe.body.id, name: 'Member' }),
    ]);

    const meta = await member.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}`)
      .send({
        priority: Priority.HIGH,
        dueDate: '2026-09-01T12:00:00.000Z',
        estimatedMinutes: 90,
      })
      .expect(200);
    expect(meta.body).toMatchObject({
      priority: 'HIGH',
      estimatedMinutes: 90,
    });
    expect(meta.body.dueDate).toBe('2026-09-01T12:00:00.000Z');

    const comment = await member.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'Looks good' })
      .expect(201);
    expect(comment.body).toMatchObject({
      body: 'Looks good',
      author: expect.objectContaining({ name: 'Member' }),
    });

    const comments = await owner.agent
      .get(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .expect(200);
    expect(comments.body).toHaveLength(1);

    await member.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/assignees/${memberMe.body.id}`)
      .expect(200);
    await member.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/labels/${label.body.id}`)
      .expect(200);
    await member.agent
      .delete(`/workspaces/${workspace.id}/comments/${comment.body.id}`)
      .expect(204);
    await owner.agent.delete(`/workspaces/${workspace.id}/labels/${label.body.id}`).expect(204);
  });

  it('enforces guest read-only for metadata mutations', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'GuestMeta', `gmeta-${Date.now()}`);
    const guestMe = await guest.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, guestMe.body.id as string, MemberRole.GUEST);
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);

    const label = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'bug', color: LabelColorSlot['slot-8'] })
      .expect(201);

    await guest.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/labels`)
      .send({ labelId: label.body.id })
      .expect(403);
    await guest.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: guestMe.body.id })
      .expect(403);
    await guest.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}`)
      .send({ priority: Priority.URGENT })
      .expect(403);
    await guest.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'Nope' })
      .expect(403);

    await guest.agent.get(`/workspaces/${workspace.id}/boards/${boardId}/labels`).expect(200);
    await guest.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}/comments`).expect(200);
  });
});
