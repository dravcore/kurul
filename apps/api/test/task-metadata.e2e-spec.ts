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
    expect(comments.body.items).toHaveLength(1);

    await member.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/assignees/${memberMe.body.id}`)
      .expect(200);
    await member.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/labels/${label.body.id}`)
      .expect(200);
    await owner.agent.delete(`/workspaces/${workspace.id}/comments/${comment.body.id}`).expect(204);
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

  it('rejects an assignee who is not a workspace member with 422', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const outsider = await signUp(app, { name: 'Outsider' });
    const workspace = await createWorkspace(owner.agent, 'Assign', `asg-${Date.now()}`);
    const outsiderMe = await outsider.agent.get('/me').expect(200);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: outsiderMe.body.id })
      .expect(422);

    const task = await owner.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(200);
    expect(task.body.assignees).toHaveLength(0);
  });

  it('rejects a duplicate assignee with 409', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Dup', `dup-${Date.now()}`);
    const ownerMe = await owner.agent.get('/me').expect(200);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: ownerMe.body.id })
      .expect(201);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: ownerMe.body.id })
      .expect(409);

    const task = await owner.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(200);
    expect(task.body.assignees).toHaveLength(1);
  });

  it('returns 404 when removing an assignee or label that is not attached', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Detach', `det-${Date.now()}`);
    const ownerMe = await owner.agent.get('/me').expect(200);
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);

    const label = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'loose', color: LabelColorSlot['slot-4'] })
      .expect(201);

    await owner.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/assignees/${ownerMe.body.id}`)
      .expect(404);
    await owner.agent
      .delete(`/workspaces/${workspace.id}/tasks/${taskId}/labels/${label.body.id}`)
      .expect(404);
  });

  it('rejects attaching a label from another board with 422', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'XBoard', `xb-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    const otherBoard = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Other' })
      .expect(201);
    const foreignLabel = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${otherBoard.body.id}/labels`)
      .send({ name: 'foreign', color: LabelColorSlot['slot-5'] })
      .expect(201);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/labels`)
      .send({ labelId: foreignLabel.body.id })
      .expect(422);

    const task = await owner.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(200);
    expect(task.body.labels).toHaveLength(0);
  });

  it('covers priority transitions and clearing dueDate/estimatedMinutes to null', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Clear', `clr-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const taskUrl = `/workspaces/${workspace.id}/tasks/${taskId}`;

    const created = await owner.agent.get(taskUrl).expect(200);
    expect(created.body.priority).toBe(Priority.MEDIUM);
    expect(created.body.dueDate).toBeNull();
    expect(created.body.estimatedMinutes).toBeNull();

    for (const priority of [Priority.LOW, Priority.URGENT, Priority.MEDIUM]) {
      const updated = await owner.agent.patch(taskUrl).send({ priority }).expect(200);
      expect(updated.body.priority).toBe(priority);
    }

    await owner.agent
      .patch(taskUrl)
      .send({ dueDate: '2026-10-01T00:00:00.000Z', estimatedMinutes: 45 })
      .expect(200);

    const cleared = await owner.agent
      .patch(taskUrl)
      .send({ dueDate: null, estimatedMinutes: null })
      .expect(200);
    expect(cleared.body.dueDate).toBeNull();
    expect(cleared.body.estimatedMinutes).toBeNull();
    // Priority is untouched by an unrelated patch.
    expect(cleared.body.priority).toBe(Priority.MEDIUM);
  });

  it('rejects invalid label payloads with 400, including raw hex colors', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'LblVal', `lv-${Date.now()}`);
    const { boardId } = await boardWithTask(owner.agent, workspace.id);
    const base = `/workspaces/${workspace.id}/boards/${boardId}/labels`;

    await owner.agent.post(base).send({ name: 'hex', color: '#ff0000' }).expect(400);
    await owner.agent.post(base).send({ name: 'slot9', color: 'slot-9' }).expect(400);
    await owner.agent.post(base).send({ name: '', color: LabelColorSlot['slot-1'] }).expect(400);
    await owner.agent
      .post(base)
      .send({ name: 'x'.repeat(51), color: LabelColorSlot['slot-1'] })
      .expect(400);
    await owner.agent.post(base).send({ name: 'no color' }).expect(400);

    const label = await owner.agent
      .post(base)
      .send({ name: 'ok', color: LabelColorSlot['slot-1'] })
      .expect(201);
    await owner.agent
      .patch(`/workspaces/${workspace.id}/labels/${label.body.id}`)
      .send({ color: '#00ff00' })
      .expect(400);
    await owner.agent
      .patch(`/workspaces/${workspace.id}/labels/${label.body.id}`)
      .send({ name: null })
      .expect(400);
    await owner.agent
      .patch(`/workspaces/${workspace.id}/labels/${label.body.id}`)
      .send({ color: null })
      .expect(400);

    const listed = await owner.agent.get(base).expect(200);
    expect(listed.body).toHaveLength(1);
  });

  it('allows ADMIN to manage board labels', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const admin = await signUp(app, { name: 'Admin' });
    const workspace = await createWorkspace(owner.agent, 'AdmLbl', `al-${Date.now()}`);
    const adminMe = await admin.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, adminMe.body.id as string, MemberRole.ADMIN);
    const { boardId } = await boardWithTask(owner.agent, workspace.id);

    const label = await admin.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'ops', color: LabelColorSlot['slot-2'] })
      .expect(201);
    await admin.agent
      .patch(`/workspaces/${workspace.id}/labels/${label.body.id}`)
      .send({ name: 'infra' })
      .expect(200);
    await admin.agent.delete(`/workspaces/${workspace.id}/labels/${label.body.id}`).expect(204);
  });

  it('returns 404 for every cross-tenant metadata access', async () => {
    const ownerA = await signUp(app, { name: 'A' });
    const ownerB = await signUp(app, { name: 'B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'MetaA', `ma-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'MetaB', `mb-${Date.now()}`);
    const ownerBMe = await ownerB.agent.get('/me').expect(200);
    const a = await boardWithTask(ownerA.agent, workspaceA.id);

    const label = await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/boards/${a.boardId}/labels`)
      .send({ name: 'secret', color: LabelColorSlot['slot-1'] })
      .expect(201);
    const labelId = label.body.id as string;

    for (const workspaceId of [workspaceA.id, workspaceB.id]) {
      await ownerB.agent.get(`/workspaces/${workspaceId}/boards/${a.boardId}/labels`).expect(404);
      await ownerB.agent
        .post(`/workspaces/${workspaceId}/boards/${a.boardId}/labels`)
        .send({ name: 'inject', color: LabelColorSlot['slot-2'] })
        .expect(404);
      await ownerB.agent
        .patch(`/workspaces/${workspaceId}/labels/${labelId}`)
        .send({ name: 'hijacked' })
        .expect(404);
      await ownerB.agent.delete(`/workspaces/${workspaceId}/labels/${labelId}`).expect(404);
      await ownerB.agent
        .post(`/workspaces/${workspaceId}/tasks/${a.taskId}/labels`)
        .send({ labelId })
        .expect(404);
      await ownerB.agent
        .post(`/workspaces/${workspaceId}/tasks/${a.taskId}/assignees`)
        .send({ userId: ownerBMe.body.id })
        .expect(404);
      await ownerB.agent
        .delete(`/workspaces/${workspaceId}/tasks/${a.taskId}/labels/${labelId}`)
        .expect(404);
      await ownerB.agent
        .delete(`/workspaces/${workspaceId}/tasks/${a.taskId}/assignees/${ownerBMe.body.id}`)
        .expect(404);
    }

    const labels = await ownerA.agent
      .get(`/workspaces/${workspaceA.id}/boards/${a.boardId}/labels`)
      .expect(200);
    expect(labels.body).toEqual([expect.objectContaining({ id: labelId, name: 'secret' })]);
  });

  it('removes a deleted label from the tasks it was attached to', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Cascade', `csc-${Date.now()}`);
    const { boardId, taskId } = await boardWithTask(owner.agent, workspace.id);

    const label = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'ephemeral', color: LabelColorSlot['slot-6'] })
      .expect(201);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/labels`)
      .send({ labelId: label.body.id })
      .expect(201);

    await owner.agent.delete(`/workspaces/${workspace.id}/labels/${label.body.id}`).expect(204);

    const task = await owner.agent.get(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(200);
    expect(task.body.labels).toHaveLength(0);
  });
});
