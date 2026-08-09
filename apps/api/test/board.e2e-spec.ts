import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Board and column API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetDatabase(prisma));

  it('creates default columns and supports privileged column changes', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Boards', `boards-${Date.now()}`);

    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Roadmap' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .expect(200);

    expect(columns.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'To Do', position: 1000, taskCount: 0 }),
        expect.objectContaining({ name: 'In Progress', position: 2000, taskCount: 0 }),
        expect.objectContaining({ name: 'Done', position: 3000, taskCount: 0 }),
      ]),
    );

    const created = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .send({ name: 'Review' })
      .expect(201);
    expect(created.body.position).toBe(4000);
  });

  it('enforces board and column permissions and hides cross-tenant boards', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const other = await signUp(app, { name: 'Other' });
    const workspace = await createWorkspace(owner.agent, 'Boards', `boards-${Date.now()}`);
    const otherWorkspace = await createWorkspace(other.agent, 'Other', `other-${Date.now()}`);
    const memberMe = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);

    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Roadmap' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .expect(200);

    await member.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Member board' })
      .expect(201);
    await member.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .send({ name: 'Denied' })
      .expect(403);
    await owner.agent
      .get(`/workspaces/${otherWorkspace.id}/boards/${board.body.id as string}`)
      .expect(404);
    await member.agent
      .delete(`/workspaces/${workspace.id}/columns/${columns.body[0].id as string}`)
      .expect(403);
  });
});
