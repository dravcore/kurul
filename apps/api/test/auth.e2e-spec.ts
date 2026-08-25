import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SIGNUP_DISABLED_ERROR } from '@kurul/shared-types';
import { SIGNUP_ENABLED_ENV } from '../src/auth/sign-up-policy';
import { DEMO_MODE_ENV } from '../src/demo/demo-mode';
import { DEMO_RESTRICTED_MESSAGE } from '../src/demo/demo-restricted.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signIn, signUp, uniqueEmail } from './helpers/auth';
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

  /**
   * The registration switch, measured through the assembled stack. `signUpEnabled()` reads
   * `process.env` on every call, so a test sets the variable and the very next request sees
   * it: no app rebuild, same as the plan-limit suite.
   */
  describe('SIGNUP_ENABLED', () => {
    const original = process.env[SIGNUP_ENABLED_ENV];

    afterEach(() => {
      if (original === undefined) delete process.env[SIGNUP_ENABLED_ENV];
      else process.env[SIGNUP_ENABLED_ENV] = original;
    });

    it('refuses sign-up with the envelope, writes no row, and leaves sign-in open', async () => {
      const existing = await signUp(app, { name: 'Already Here' });
      process.env[SIGNUP_ENABLED_ENV] = 'false';

      const email = uniqueEmail('refused');
      const refused = await request(app.getHttpServer())
        .post('/auth/sign-up/email')
        .send({ email, password: 'password-for-tests-1', name: 'Nope' })
        .expect(403);

      // The whole envelope, not a subset: this is written by hand below the Nest router, so
      // nothing but this assertion keeps it in the shape `docs/api-conventions.md` promises.
      expect(refused.body).toEqual({
        statusCode: 403,
        error: SIGNUP_DISABLED_ERROR,
        message: expect.any(String),
        path: '/auth/sign-up/email',
        timestamp: expect.any(String),
        requestId: expect.any(String),
      });
      expect(refused.body.requestId).toBe(refused.headers['x-request-id']);

      await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull();
      await expect(prisma.user.count()).resolves.toBe(1);

      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .send({ email: existing.email, password: existing.password })
        .expect(200);

      const config = await existing.agent.get('/config').expect(200);
      expect(config.body.signUpEnabled).toBe(false);
    });

    it('is open when the variable is unset, and GET /config says so', async () => {
      delete process.env[SIGNUP_ENABLED_ENV];

      const user = await signUp(app, { name: 'Walked In' });

      const config = await user.agent.get('/config').expect(200);
      expect(config.body.signUpEnabled).toBe(true);
    });
  });

  /**
   * The demo lock-out on the one `/auth/*` route that takes the shared account away from every
   * other visitor. `demoModeEnabled()` is read per request like the switch above.
   */
  describe('DEMO_MODE and the shared account password', () => {
    const original = process.env[DEMO_MODE_ENV];

    afterEach(() => {
      if (original === undefined) delete process.env[DEMO_MODE_ENV];
      else process.env[DEMO_MODE_ENV] = original;
    });

    async function credentialHash(userId: string): Promise<string | null> {
      const account = await prisma.account.findFirstOrThrow({ where: { userId } });
      return account.password;
    }

    it('refuses change-password on a demo and leaves the hash alone', async () => {
      const user = await signUp(app, { name: 'Demo Visitor' });
      const me = await user.agent.get('/me').expect(200);
      const before = await credentialHash(me.body.id);
      process.env[DEMO_MODE_ENV] = 'true';

      const refused = await user.agent
        .post('/auth/change-password')
        .send({ currentPassword: user.password, newPassword: 'rotated-by-a-stranger-1' })
        .expect(403);

      expect(refused.body).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        message: DEMO_RESTRICTED_MESSAGE,
        path: '/auth/change-password',
        timestamp: expect.any(String),
        requestId: expect.any(String),
      });
      await expect(credentialHash(me.body.id)).resolves.toBe(before);

      // The published password still opens the door, which is the whole point.
      await signIn(app, user.email, user.password);
    });

    it('lets an ordinary instance change the password', async () => {
      delete process.env[DEMO_MODE_ENV];
      const user = await signUp(app, { name: 'Self Hosted' });
      const me = await user.agent.get('/me').expect(200);
      const before = await credentialHash(me.body.id);

      await user.agent
        .post('/auth/change-password')
        .send({ currentPassword: user.password, newPassword: 'chosen-by-the-owner-1' })
        .expect(200);

      await expect(credentialHash(me.body.id)).resolves.not.toBe(before);
      await signIn(app, user.email, 'chosen-by-the-owner-1');
    });
  });
});
