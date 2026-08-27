import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DEMO_MODE_ENV } from '../src/demo/demo-mode';
import {
  DEMO_BOARDS,
  DEMO_TEAMMATE_EMAIL,
  DEMO_USER_EMAIL,
  DEMO_WORKSPACE_SLUG,
} from '../src/demo/demo-dataset';
import { resetDemoData } from '../src/demo/reset';
import { assertDemoResetAllowed } from '../src/demo/reset-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDatabase } from './helpers/db';
import { signIn, signUp, type TestUser } from './helpers/auth';

const DEMO_PASSWORD = 'demo-password-for-tests';

/**
 * The demo reset, run for real against `kurul_test`.
 *
 * The point of running the actual `resetDemoData` rather than a stand-in is that this is code
 * that ships in the production image, is invoked by a container on a loop, and starts by
 * deleting every row it can reach. There is no second implementation to check it against, and
 * a mocked version of "delete everything, then insert everything" tests nothing at all.
 *
 * `kurul_test` is what makes that possible, and it is also why `reset-guard.ts` accepts a
 * database whose name contains `test` alongside one containing `demo` — the alternative was an
 * override flag shipped inside the image, which `seed-guard.ts` argues against by name. The
 * guard's own refusals are unit-tested in `src/demo/reset-guard.spec.ts`; this file checks the
 * one thing a unit test cannot, which is that the pair of checks and the script agree.
 *
 * Like every other suite that calls `resetDatabase`, this one empties the database it runs
 * against. That is the same contract `test/setup-e2e.ts` already enforces on `DATABASE_URL`.
 */
describe('Demo reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const originalDemoMode = process.env[DEMO_MODE_ENV];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Left clean for whatever spec runs next: this file's last act is a database full of demo
    // fixtures, and the next suite's `signUp` would otherwise inherit them.
    await resetDatabase(prisma);
    await app.close();
  });

  afterEach(() => {
    if (originalDemoMode === undefined) {
      delete process.env[DEMO_MODE_ENV];
    } else {
      process.env[DEMO_MODE_ENV] = originalDemoMode;
    }
  });

  describe('the guard, against the database this suite actually runs on', () => {
    it('refuses without DEMO_MODE, whatever the database is called', () => {
      delete process.env[DEMO_MODE_ENV];

      expect(() =>
        assertDemoResetAllowed({
          demoMode: process.env[DEMO_MODE_ENV],
          databaseUrl: process.env.DATABASE_URL,
        }),
      ).toThrow(/DEMO_MODE is not "true"/);
    });

    it('allows this test database once DEMO_MODE is on', () => {
      const name = assertDemoResetAllowed({
        demoMode: 'true',
        databaseUrl: process.env.DATABASE_URL,
      });

      expect(name).toMatch(/demo|test/);
    });
  });

  describe('what the reset restores', () => {
    let staleSessionToken: string;
    let sessionsAfterReset: number;

    beforeAll(async () => {
      await resetDatabase(prisma);
      // A live visitor with an open session, so the wipe has something of somebody else's to
      // destroy — which is the situation the demo host is in every single hour.
      const existing = await signUp(app);
      await existing.agent.get('/me').expect(200);

      // The credential on its own, without the signed 60-second cache cookie beside it. See the
      // refusal test below for why that separation is the whole point.
      const signIn = await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .send({ email: existing.email, password: existing.password })
        .expect(200);
      const cookies = (signIn.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
      const token = cookies
        .map((cookie) => cookie.split(';')[0] ?? '')
        .find((cookie) => cookie.startsWith('better-auth.session_token='));
      expect(token).toBeDefined();
      staleSessionToken = token as string;

      await resetDemoData(prisma, DEMO_PASSWORD);
      // Read here rather than inside the test: a later case in this block signs the demo account
      // in, which is a session, and asserting on the count after that would be asserting on test
      // ordering instead of on the reset.
      sessionsAfterReset = await prisma.session.count();
    });

    it('leaves exactly the demo workspace behind', async () => {
      const workspaces = await prisma.workspace.findMany({ select: { slug: true } });

      expect(workspaces).toEqual([{ slug: DEMO_WORKSPACE_SLUG }]);
    });

    it('writes every board in the dataset, with its columns and labels', async () => {
      const boards = await prisma.board.findMany({
        select: { name: true, _count: { select: { columns: true, labels: true } } },
        orderBy: { name: 'asc' },
      });

      const expected = [...DEMO_BOARDS]
        .map((board) => ({
          name: board.name,
          _count: { columns: board.columns.length, labels: board.labels.length },
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      expect(boards).toEqual(expected);
    });

    /**
     * Every column has work in it. This is the acceptance criterion the dataset exists for: a
     * stranger clicking a link in an announcement lands on a board that looks used, not on a
     * "To Do" column with four cards and four empty ones beside it.
     */
    it('puts at least one task in every column', async () => {
      const columns = await prisma.column.findMany({
        select: { name: true, _count: { select: { tasks: true } } },
      });

      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(column._count.tasks).toBeGreaterThan(0);
      }
    });

    it('writes comments, assignees, labels and checklists, not just cards', async () => {
      const [comments, assignees, taskLabels, checklistItems] = await Promise.all([
        prisma.comment.count(),
        prisma.taskAssignee.count(),
        prisma.taskLabel.count(),
        prisma.checklistItem.count(),
      ]);

      expect(comments).toBeGreaterThan(0);
      expect(assignees).toBeGreaterThan(0);
      expect(taskLabels).toBeGreaterThan(0);
      expect(checklistItems).toBeGreaterThan(0);
    });

    /**
     * `Label.color` holds a design-token slot, never a hex (CLAUDE.md). The dataset is a hand
     * written literal, which is exactly the kind of place a `#7c3aed` gets typed.
     */
    it('stores label colours as design-token slots', async () => {
      const labels = await prisma.label.findMany({ select: { color: true } });

      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.color).toMatch(/^slot-[1-8]$/);
      }
    });

    /** Due dates are relative to the reset, so the demo never fills up with stale red cards. */
    it('dates the work around the moment of the reset', async () => {
      const soonest = await prisma.task.findFirst({
        where: { dueDate: { not: null } },
        orderBy: { dueDate: 'asc' },
        select: { dueDate: true },
      });
      const latest = await prisma.task.findFirst({
        where: { dueDate: { not: null } },
        orderBy: { dueDate: 'desc' },
        select: { dueDate: true },
      });

      const month = 30 * 86_400_000;
      expect(Date.now() - (soonest?.dueDate?.getTime() ?? 0)).toBeLessThan(month);
      expect((latest?.dueDate?.getTime() ?? 0) - Date.now()).toBeLessThan(month);
    });

    it('publishes a demo account that can sign in with DEMO_PASSWORD', async () => {
      const agent = await signIn(app, DEMO_USER_EMAIL, DEMO_PASSWORD);

      const me = await agent.get('/me').expect(200);
      expect(me.body.email).toBe(DEMO_USER_EMAIL);
    });

    /**
     * The teammate exists so comments and assignments are not all the visitor's own, and has no
     * `Account` row on purpose: there is no password to guess and none to publish.
     */
    it('gives the teammate no credentials at all', async () => {
      const teammate = await prisma.user.findUnique({
        where: { email: DEMO_TEAMMATE_EMAIL },
        select: { id: true, accounts: { select: { id: true } } },
      });

      expect(teammate).not.toBeNull();
      expect(teammate?.accounts).toEqual([]);
    });

    /**
     * Not just the visitor's: `signUpEmail` signs the demo account in, so the reset creates a
     * session of its own that nobody will ever present. Zero is the invariant.
     */
    it('leaves no session behind at all, including its own', () => {
      expect(sessionsAfterReset).toBe(0);
    });

    /**
     * The API's half of the contract: a session token that no longer exists is refused with
     * `401`, which is the status the web's redirect-to-sign-in path is built on.
     *
     * Sent as a bare `better-auth.session_token` rather than through `existing.agent`, and that
     * is the interesting part. The agent also holds `better-auth.session_data`, the signed
     * 60-second cache `auth.api.getSession` answers from without reading the database
     * (`session-cookie-names.ts`), so the agent keeps being recognised for up to a minute after
     * the rows are gone. Dropping that cookie is what asks the database the question. The
     * one-minute seam it exposes is real, inherent to a signed cache, and documented on
     * `reset.ts`; what must not also be true is that the credential itself outlives the wipe.
     */
    it('refuses the previous visitor once the cookie cache is out of the way', async () => {
      await request(app.getHttpServer())
        .get('/workspaces')
        .set('Cookie', staleSessionToken)
        .expect(401);
    });
  });

  describe('what a demo instance refuses', () => {
    let owner: TestUser;
    let workspaceId: string;

    beforeAll(async () => {
      await resetDatabase(prisma);
      owner = await signUp(app);
      const created = await owner.agent
        .post('/workspaces')
        .send({ name: 'Demo guard workspace', slug: `demo-guard-${Date.now()}` })
        .expect(201);
      workspaceId = created.body.id;
    });

    it('publishes the demo section on GET /config', async () => {
      process.env[DEMO_MODE_ENV] = 'true';
      process.env.DEMO_RESET_INTERVAL_MINUTES = '60';

      const response = await owner.agent.get('/config').expect(200);

      expect(response.body.demo.enabled).toBe(true);
      expect(response.body.demo.resetIntervalMinutes).toBe(60);
      expect(typeof response.body.demo.nextResetAt).toBe('string');
      expect(new Date(response.body.demo.nextResetAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('reports demo.enabled false on an ordinary instance', async () => {
      delete process.env[DEMO_MODE_ENV];

      const response = await owner.agent.get('/config').expect(200);

      expect(response.body.demo).toEqual({
        enabled: false,
        resetIntervalMinutes: null,
        nextResetAt: null,
      });
    });

    it('refuses workspace deletion with 403', async () => {
      process.env[DEMO_MODE_ENV] = 'true';

      await owner.agent.delete(`/workspaces/${workspaceId}`).expect(403);
      expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(1);
    });

    it('refuses account deletion with 403', async () => {
      process.env[DEMO_MODE_ENV] = 'true';

      // The guard runs ahead of `ValidationPipe`, so the body is only here to prove the refusal
      // is the demo's and not a `400` about a missing confirmation.
      await owner.agent.delete('/me').send({ confirmEmail: owner.email }).expect(403);
      expect(await prisma.user.count({ where: { email: owner.email } })).toBe(1);
    });

    /** The same two routes are the product working on every instance that is not a demo. */
    it('allows workspace deletion once demo mode is off', async () => {
      delete process.env[DEMO_MODE_ENV];

      await owner.agent.delete(`/workspaces/${workspaceId}`).expect(204);
    });
  });
});
