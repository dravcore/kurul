import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signIn, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Auth (e2e)', () => {
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

  it('registers, returns session on /me, and rejects unauthenticated /me', async () => {
    const user = await signUp(app);

    await user.agent
      .get('/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(user.email);
        expect(body.name).toBe(user.name);
        expect(body.id).toEqual(expect.any(String));
      });

    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('logs in and out', async () => {
    const user = await signUp(app);

    await user.agent.post('/auth/sign-out').expect((res) => {
      expect(res.status).toBeLessThan(500);
    });

    await user.agent.get('/me').expect(401);

    const agent = await signIn(app, user.email, user.password);
    await agent.get('/me').expect(200);
  });

  it('rejects a tampered session cookie', async () => {
    await signUp(app);

    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', ['better-auth.session_token=not-a-real-session'])
      .expect(401);
  });

  it('creates a workspace owned by the signed-in user', async () => {
    const user = await signUp(app);
    const workspace = await createWorkspace(user.agent, 'Alpha', 'alpha-ws');

    const me = await user.agent.get('/me').expect(200);
    const members = await user.agent.get(`/workspaces/${workspace.id}/members`).expect(200);

    expect(members.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: me.body.id,
          role: 'OWNER',
          workspaceId: workspace.id,
        }),
      ]),
    );
  });
});
