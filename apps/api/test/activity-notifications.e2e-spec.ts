import { INestApplication } from '@nestjs/common';
import { ActivityType, MemberRole, NotificationType } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Activity & notifications (e2e)', () => {
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
  ): Promise<{ boardId: string; columnId: string; taskId: string }> {
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
      columnId: columns.body[0].id as string,
      taskId: task.body.id as string,
    };
  }

  it('records task.created activity on the workspace and task feeds', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Act', `act-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    const workspaceFeed = await owner.agent
      .get(`/workspaces/${workspace.id}/activities`)
      .expect(200);
    expect(workspaceFeed.body.items[0]).toMatchObject({
      type: ActivityType.TaskCreated,
      taskId,
      author: expect.objectContaining({ name: 'Owner' }),
      payload: expect.objectContaining({ title: 'Card' }),
    });

    const taskFeed = await owner.agent
      .get(`/workspaces/${workspace.id}/tasks/${taskId}/activities`)
      .expect(200);
    expect(taskFeed.body.items).toHaveLength(1);
    expect(taskFeed.body.items[0].type).toBe(ActivityType.TaskCreated);
  });

  it('notifies the assignee (not the actor) and supports mark-read', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Assign', `asg-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: memberMe.body.id })
      .expect(201);

    const ownerNotes = await owner.agent
      .get(`/workspaces/${workspace.id}/notifications`)
      .expect(200);
    expect(ownerNotes.body.items).toHaveLength(0);

    const unread = await member.agent
      .get(`/workspaces/${workspace.id}/notifications/unread-count`)
      .expect(200);
    expect(unread.body).toEqual({ count: 1 });

    const memberNotes = await member.agent
      .get(`/workspaces/${workspace.id}/notifications`)
      .expect(200);
    expect(memberNotes.body.items).toHaveLength(1);
    expect(memberNotes.body.items[0]).toMatchObject({
      type: NotificationType.Assignment,
      taskId,
      readAt: null,
    });

    const notificationId = memberNotes.body.items[0].id as string;
    await member.agent
      .post(`/workspaces/${workspace.id}/notifications/${notificationId}/read`)
      .expect(200);

    const after = await member.agent
      .get(`/workspaces/${workspace.id}/notifications/unread-count`)
      .expect(200);
    expect(after.body).toEqual({ count: 0 });
  });

  it('creates mention notifications from comment markup and mark-all-read', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Mention', `men-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    const memberId = memberMe.body.id as string;
    await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: `Ping @[Member](${memberId}) please` })
      .expect(201);

    const notes = await member.agent
      .get(`/workspaces/${workspace.id}/notifications?unreadOnly=true`)
      .expect(200);
    expect(notes.body.items).toHaveLength(1);
    expect(notes.body.items[0].type).toBe(NotificationType.Mention);

    const activities = await owner.agent
      .get(`/workspaces/${workspace.id}/tasks/${taskId}/activities`)
      .expect(200);
    expect(
      activities.body.items.some((a: { type: string }) => a.type === ActivityType.CommentCreated),
    ).toBe(true);

    await member.agent.post(`/workspaces/${workspace.id}/notifications/read-all`).expect(200);
    const unread = await member.agent
      .get(`/workspaces/${workspace.id}/notifications/unread-count`)
      .expect(200);
    expect(unread.body).toEqual({ count: 0 });
  });

  it('filters notifications by type', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Filter', `flt-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    const memberId = memberMe.body.id as string;
    await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: memberId })
      .expect(201);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: `Hey @[Member](${memberId})` })
      .expect(201);

    const assignments = await member.agent
      .get(`/workspaces/${workspace.id}/notifications?type=assignment`)
      .expect(200);
    expect(assignments.body.items).toHaveLength(1);
    expect(assignments.body.items[0].type).toBe(NotificationType.Assignment);

    const mentions = await member.agent
      .get(`/workspaces/${workspace.id}/notifications?type=mention`)
      .expect(200);
    expect(mentions.body.items).toHaveLength(1);
    expect(mentions.body.items[0].type).toBe(NotificationType.Mention);

    await member.agent
      .get(`/workspaces/${workspace.id}/notifications?type=not-a-type`)
      .expect(400);
  });
});
