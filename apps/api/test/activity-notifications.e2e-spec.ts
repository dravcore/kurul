import { INestApplication } from '@nestjs/common';
import { ActivityType, MemberRole, NotificationType } from '@kurul/shared-types';
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

  it('keeps prior activity rows after a task is deleted', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'KeepAct', `keep-act-${Date.now()}`);
    const { taskId } = await boardWithTask(owner.agent, workspace.id);

    await owner.agent.delete(`/workspaces/${workspace.id}/tasks/${taskId}`).expect(204);

    const workspaceFeed = await owner.agent
      .get(`/workspaces/${workspace.id}/activities`)
      .expect(200);
    const types = (workspaceFeed.body.items as Array<{ type: string; taskId: string | null }>).map(
      (row) => row.type,
    );
    expect(types).toContain(ActivityType.TaskCreated);
    expect(types).toContain(ActivityType.TaskDeleted);
    expect(
      (workspaceFeed.body.items as Array<{ type: string; taskId: string | null }>).every(
        (row) => row.taskId === null,
      ),
    ).toBe(true);
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

    await member.agent.get(`/workspaces/${workspace.id}/notifications?type=not-a-type`).expect(400);
  });

  it('returns 404, never 403, when a member of workspace A requests workspace B activities or notifications', async () => {
    const ownerA = await signUp(app, { name: 'OwnerA' });
    const ownerB = await signUp(app, { name: 'OwnerB' });
    const memberB = await signUp(app, { name: 'MemberB' });
    const workspaceA = await createWorkspace(ownerA.agent, 'IsoA', `iso-a-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'IsoB', `iso-b-${Date.now()}`);
    const memberBMe = await memberB.agent.get('/me').expect(200);
    await addMember(prisma, workspaceB.id, memberBMe.body.id as string, MemberRole.MEMBER);
    const { taskId } = await boardWithTask(ownerB.agent, workspaceB.id);

    await ownerB.agent
      .post(`/workspaces/${workspaceB.id}/tasks/${taskId}/assignees`)
      .send({ userId: memberBMe.body.id })
      .expect(201);

    const memberBNotes = await memberB.agent
      .get(`/workspaces/${workspaceB.id}/notifications`)
      .expect(200);
    const notificationId = memberBNotes.body.items[0].id as string;

    // Control: `ownerA` can read their own (empty) workspace fine, so the 404s below are
    // tenant isolation, not a broken route.
    await ownerA.agent.get(`/workspaces/${workspaceA.id}/activities`).expect(200);

    // `ownerA` is not a member of workspace B: the workspace guard answers 404 before any
    // workspace- or task-scoped read, the same convention `comment.e2e-spec.ts` and
    // `trello-import.e2e-spec.ts` already use for cross-tenant access.
    await ownerA.agent.get(`/workspaces/${workspaceB.id}/activities`).expect(404);
    await ownerA.agent.get(`/workspaces/${workspaceB.id}/tasks/${taskId}/activities`).expect(404);
    await ownerA.agent.get(`/workspaces/${workspaceB.id}/notifications`).expect(404);
    await ownerA.agent.get(`/workspaces/${workspaceB.id}/notifications/unread-count`).expect(404);
    await ownerA.agent
      .post(`/workspaces/${workspaceB.id}/notifications/${notificationId}/read`)
      .expect(404);
    await ownerA.agent.post(`/workspaces/${workspaceB.id}/notifications/read-all`).expect(404);

    const untouched = await prisma.notification.findUnique({ where: { id: notificationId } });
    expect(untouched?.readAt).toBeNull();
  });
});
