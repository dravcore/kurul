import { INestApplication } from '@nestjs/common';
import { MailDeliveryStatus } from '@kurul/shared-types';
import request from 'supertest';
import { App } from 'supertest/types';
import type { MailMessage } from '../src/mail/mail-sender';
import * as sendMailModule from '../src/mail/send-mail';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signIn, signUp, uniqueEmail } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  /**
   * Every message the Better Auth hooks hand to `sendMail`. Captured at that function rather
   * than at `MailService` (the notification-mail pattern), because the reset email is sent from
   * `emailAndPassword.sendResetPassword`, which Better Auth calls with no injection point of its
   * own; `sendMail` is the one seam it does go through. Nothing process-wide is touched: the
   * spy is on this suite's module instance and is restored with it.
   */
  const outbox: MailMessage[] = [];
  let sendMail: jest.SpyInstance;

  beforeAll(async () => {
    sendMail = jest.spyOn(sendMailModule, 'sendMail').mockImplementation((message) => {
      outbox.push(message);
      return Promise.resolve(MailDeliveryStatus.SENT);
    });
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    sendMail.mockRestore();
    await app.close();
  });

  beforeEach(async () => {
    outbox.length = 0;
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

  describe('password reset', () => {
    const NEW_PASSWORD = 'a-brand-new-password-1';
    /** What Better Auth answers request-password-reset with, whatever the address. */
    const NEUTRAL_REPLY = {
      status: true,
      message: 'If this email exists in our system, check your email for the reset link',
    };

    /** The reset email, and the one link in it, as the recipient would find them. */
    function capturedResetLink(): { message: MailMessage; link: URL } {
      const resets = outbox.filter((message) => /password|parola/i.test(message.subject));
      expect(resets).toHaveLength(1);
      const message = resets[0]!;
      const raw = message.text.split('\n').find((line) => line.startsWith('http'));
      expect(raw).toBeDefined();
      return { message, link: new URL(raw!) };
    }

    /**
     * Follows the emailed link the way a browser would: the API checks the token and redirects
     * to the web app with it. Returns the token the web page would read off the URL.
     */
    async function followLink(link: URL): Promise<{ token: string | null; error: string | null }> {
      expect(link.origin).toBe(process.env.BETTER_AUTH_URL);
      const response = await request(app.getHttpServer())
        .get(`${link.pathname}${link.search}`)
        .expect(302);
      const landing = new URL(response.headers['location'] as string);
      expect(`${landing.origin}${landing.pathname}`).toBe(`${process.env.WEB_URL}/reset-password`);
      return { token: landing.searchParams.get('token'), error: landing.searchParams.get('error') };
    }

    it('emails a one-hour link that lands on the web app, resets the password once, and ends the old sessions', async () => {
      const user = await signUp(app, { name: 'Forgetful' });
      // A second browser, signed in with the password about to be replaced. Its cookie is not
      // replayed after the reset: the 60-second cookie cache (`session.cookieCache`) would keep
      // it looking live, so the revocation is asserted on the rows instead.
      await signIn(app, user.email, user.password);
      const userId = (await user.agent.get('/me').expect(200)).body.id as string;
      expect(await prisma.session.count({ where: { userId } })).toBe(2);
      outbox.length = 0;

      await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: user.email, redirectTo: '/reset-password' })
        .expect(200)
        .expect(({ body }) => expect(body).toEqual(NEUTRAL_REPLY));

      const { message, link } = capturedResetLink();
      expect(message.to).toBe(user.email);
      expect(message.text).toContain('Forgetful');
      expect(message.text).toContain('one hour');
      // The token stays on the API, which checks it; the hand-off afterwards is the web app's.
      expect(link.searchParams.get('callbackURL')).toBe(`${process.env.WEB_URL}/reset-password`);
      const stored = await prisma.verification.findFirst({
        where: { value: userId, identifier: { startsWith: 'reset-password:' } },
      });
      expect(stored).not.toBeNull();
      const ttlMs = stored!.expiresAt.getTime() - stored!.createdAt.getTime();
      expect(ttlMs).toBeGreaterThan(3_500_000);
      expect(ttlMs).toBeLessThanOrEqual(3_600_000);

      const { token, error } = await followLink(link);
      expect(error).toBeNull();
      expect(token).toEqual(expect.any(String));

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: NEW_PASSWORD, token })
        .expect(200)
        .expect(({ body }) => expect(body).toEqual({ status: true }));

      // Every session the account had is gone, the one that asked and the one elsewhere alike.
      expect(await prisma.session.count({ where: { userId } })).toBe(0);
      // The token row went with the reset: the link is single-use by construction.
      expect(await prisma.verification.count({ where: { value: userId } })).toBe(0);

      const fresh = await signIn(app, user.email, NEW_PASSWORD);
      await fresh.get('/me').expect(200);
      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password })
        .expect(401);

      // A second use of the same token is refused, and changes nothing.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: 'yet-another-password-2', token })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_TOKEN'));
      await signIn(app, user.email, NEW_PASSWORD);
    });

    it('answers an unknown address exactly like a known one, and sends nothing', async () => {
      const known = await signUp(app);
      outbox.length = 0;

      const unknown = await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: uniqueEmail('nobody'), redirectTo: '/reset-password' })
        .expect(200);
      const knownReply = await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: known.email, redirectTo: '/reset-password' })
        .expect(200);

      expect(unknown.body).toEqual(knownReply.body);
      expect(unknown.body).toEqual(NEUTRAL_REPLY);
      expect(outbox.map((message) => message.to)).toEqual([known.email]);
    });

    it('refuses an expired token, from the link and from the form alike', async () => {
      const user = await signUp(app);
      outbox.length = 0;
      await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: user.email })
        .expect(200);
      const { link } = capturedResetLink();
      // The client passed no `redirectTo`; the API still points the hand-off at the web app.
      expect(link.searchParams.get('callbackURL')).toBe(`${process.env.WEB_URL}/reset-password`);
      const token = link.pathname.split('/').pop()!;

      await prisma.verification.updateMany({
        where: { identifier: `reset-password:${token}` },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const landing = await followLink(link);
      expect(landing).toEqual({ token: null, error: 'INVALID_TOKEN' });
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: NEW_PASSWORD, token })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_TOKEN'));
      await signIn(app, user.email, user.password);
    });

    it('keeps the eight-character password rule on the reset form', async () => {
      const user = await signUp(app);
      outbox.length = 0;
      await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: user.email })
        .expect(200);
      const token = capturedResetLink().link.pathname.split('/').pop()!;

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: 'short', token })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('PASSWORD_TOO_SHORT'));
      // The refusal happened before the token was consumed, so the link still works.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: NEW_PASSWORD, token })
        .expect(200);
    });
  });
});
