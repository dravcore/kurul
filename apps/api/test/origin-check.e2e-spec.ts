import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { buildUniqueSlug, createWorkspace, signUp, TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The origin allowlist, exercised against the real stack rather than a probe controller.
 *
 * `src/common/origin-check.spec.ts` covers the middleware's own decision table. This file
 * exists because the claim worth defending is not "the middleware returns 403" — it is that a
 * request holding a **genuine session cookie**, aimed at a **real state-changing endpoint**,
 * no longer changes state when it announces a foreign origin. Every rejection below was
 * measured returning `201`/`204` on the build immediately before this middleware landed.
 */
const EVIL_ORIGIN = 'https://evil.example';

describe('Origin allowlist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let webOrigin: string;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    webOrigin = process.env.WEB_URL ?? 'http://localhost:3000';
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await signUp(app);
  });

  describe('a cross-site write with a valid session cookie', () => {
    it('is refused, and creates nothing', async () => {
      const slug = buildUniqueSlug('csrf');

      const response = await user.agent
        .post('/workspaces')
        .set('Origin', EVIL_ORIGIN)
        .send({ name: 'CSRF', slug })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
      });
      // The point of the whole change: the row must not exist. A 403 that still wrote would
      // be a passing test and an unfixed finding.
      await expect(prisma.workspace.findUnique({ where: { slug } })).resolves.toBeNull();
    });

    it('is refused even form-encoded — the shape that never triggers a CORS preflight', async () => {
      // `application/x-www-form-urlencoded` makes a cross-site POST a *simple request*: the
      // browser sends it with no preflight, so CORS never gets to decide anything. Nest's
      // Express adapter parses the body all the same, which is why this exact request was
      // measured creating a workspace (`201`) before the allowlist existed. This is the case
      // where CORS was never a layer at all.
      const slug = buildUniqueSlug('csrf-form');

      await user.agent
        .post('/workspaces')
        .set('Origin', EVIL_ORIGIN)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`name=CSRF&slug=${slug}`)
        .expect(403);

      await expect(prisma.workspace.findUnique({ where: { slug } })).resolves.toBeNull();
    });

    it('is refused for a destructive method, and the workspace survives', async () => {
      const workspace = await createWorkspace(user.agent, 'Keep me', 'keep');

      await user.agent.delete(`/workspaces/${workspace.id}`).set('Origin', EVIL_ORIGIN).expect(403);

      await expect(
        prisma.workspace.findUnique({ where: { id: workspace.id } }),
      ).resolves.not.toBeNull();
    });

    it('is refused on the Better Auth mount, which no Nest guard can see', async () => {
      // ADR 0004: `/auth/*` is raw Express below the Nest router. Better Auth's own
      // `originCheck` guards redirect targets, not credential endpoints — this same request
      // was measured answering `200` before the middleware landed.
      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .set('Origin', EVIL_ORIGIN)
        .send({ email: user.email, password: user.password })
        .expect(403);
    });
  });

  describe('the deployment that actually exists', () => {
    it('lets the web app write, with its Origin attached exactly as a browser sends it', async () => {
      await user.agent
        .post('/workspaces')
        .set('Origin', webOrigin)
        .send({ name: 'Legit', slug: buildUniqueSlug('legit') })
        .expect(201);
    });

    it('lets the web app sign in', async () => {
      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .set('Origin', webOrigin)
        .send({ email: user.email, password: user.password })
        .expect(200);
    });

    it('lets a non-browser client write, since it cannot be made to replay a session', async () => {
      await user.agent
        .post('/workspaces')
        .send({ name: 'Script', slug: buildUniqueSlug('script') })
        .expect(201);
    });

    it('still allows a cross-origin read, which CORS governs on the browser side', async () => {
      await user.agent.get('/workspaces').set('Origin', EVIL_ORIGIN).expect(200);
    });
  });
});
