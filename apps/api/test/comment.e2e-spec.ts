import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurul/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Comments (e2e)', () => {
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

  it('lists comments in creation order with author details', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Comments', `cmt-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const url = `/workspaces/${workspace.id}/tasks/${taskId}/comments`;

    await owner.agent.post(url).send({ body: 'First' }).expect(201);
    await member.agent.post(url).send({ body: 'Second' }).expect(201);

    const listed = await member.agent.get(url).expect(200);
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.hasMore).toBe(false);
    expect(listed.body.items[0]).toMatchObject({
      body: 'First',
      taskId,
      author: expect.objectContaining({ name: 'Owner' }),
    });
    expect(listed.body.items[1]).toMatchObject({
      body: 'Second',
      author: expect.objectContaining({ name: 'Member', avatarUrl: null }),
    });
  });

  it('paginates comments by cursor when more than `limit` exist', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'CmtPage', `cp-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const url = `/workspaces/${workspace.id}/tasks/${taskId}/comments`;

    for (let i = 0; i < 3; i += 1) {
      await owner.agent
        .post(url)
        .send({ body: `Comment ${i}` })
        .expect(201);
    }

    const firstPage = await owner.agent.get(`${url}?limit=2`).expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await owner.agent
      .get(`${url}?limit=2&cursor=${firstPage.body.nextCursor}`)
      .expect(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.hasMore).toBe(false);
    expect(secondPage.body.items[0]).toMatchObject({ body: 'Comment 2' });
  });

  it('restricts comment deletion to the author or an elevated role (ADR 0012)', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'FlatDel', `fd-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    const comment = await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'Owner wrote this' })
      .expect(201);

    await member.agent
      .delete(`/workspaces/${workspace.id}/comments/${comment.body.id}`)
      .expect(403);

    const listed = await owner.agent
      .get(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);

    await owner.agent.delete(`/workspaces/${workspace.id}/comments/${comment.body.id}`).expect(204);
  });

  it('denies GUEST comment deletion', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'GuestDel', `gd-${Date.now()}`);
    const guestMe = await guest.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, guestMe.body.id as string, MemberRole.GUEST);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    const comment = await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'Keep out' })
      .expect(201);

    await guest.agent.delete(`/workspaces/${workspace.id}/comments/${comment.body.id}`).expect(403);
  });

  it('rejects invalid comment bodies with 400', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'CmtVal', `cv-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);
    const url = `/workspaces/${workspace.id}/tasks/${taskId}/comments`;

    await owner.agent.post(url).send({}).expect(400);
    await owner.agent.post(url).send({ body: '' }).expect(400);
    await owner.agent.post(url).send({ body: 42 }).expect(400);
    await owner.agent
      .post(url)
      .send({ body: 'x'.repeat(10_001) })
      .expect(400);
    await owner.agent.post(url).send({ body: 'ok', extra: 'field' }).expect(400);

    const listed = await owner.agent.get(url).expect(200);
    expect(listed.body.items).toHaveLength(0);
  });

  it('returns 404 for comments on a task the caller cannot see', async () => {
    const ownerA = await signUp(app, { name: 'A' });
    const ownerB = await signUp(app, { name: 'B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'CmtA', `ca-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'CmtB', `cb-${Date.now()}`);
    const a = await boardWithTask(ownerA.agent, workspaceA.id);

    const comment = await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/tasks/${a.taskId}/comments`)
      .send({ body: 'Private' })
      .expect(201);

    for (const workspaceId of [workspaceA.id, workspaceB.id]) {
      await ownerB.agent.get(`/workspaces/${workspaceId}/tasks/${a.taskId}/comments`).expect(404);
      await ownerB.agent
        .post(`/workspaces/${workspaceId}/tasks/${a.taskId}/comments`)
        .send({ body: 'Injected' })
        .expect(404);
      await ownerB.agent
        .delete(`/workspaces/${workspaceId}/comments/${comment.body.id}`)
        .expect(404);
    }

    const survivor = await prisma.comment.findUnique({
      where: { id: comment.body.id as string },
    });
    expect(survivor?.body).toBe('Private');
  });

  it('returns 404 for comments on a nonexistent task', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'CmtGhost', `cg-${Date.now()}`);
    await boardWithTask(owner.agent, workspace.id);
    const ghostTask = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99';

    await owner.agent.get(`/workspaces/${workspace.id}/tasks/${ghostTask}/comments`).expect(404);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${ghostTask}/comments`)
      .send({ body: 'Into the void' })
      .expect(404);
    await owner.agent.delete(`/workspaces/${workspace.id}/comments/${ghostTask}`).expect(404);
  });

  it('cascades comment deletion when the task is deleted', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'CmtCasc', `cc-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'Doomed' })
      .expect(201);

    await owner.agent.delete(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(204);

    const remaining = await prisma.comment.count({ where: { taskId } });
    expect(remaining).toBe(0);
  });
});
