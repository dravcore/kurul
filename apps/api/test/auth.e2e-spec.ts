import { INestApplication } from '@nestjs/common';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { SIGNUP_DISABLED_ERROR } from '@kurul/shared-types';
import { AUTH_BODY_MAX_BYTES } from '../src/auth/auth-body-limit';
import { SIGNUP_ENABLED_ENV } from '../src/auth/sign-up-policy';
import { REQUEST_BODY_TOO_LARGE_MESSAGE } from '../src/common/filters/all-exceptions.filter';
import { UUID_V7_REGEX } from '../src/common/uuid';
import { DEMO_MODE_ENV } from '../src/demo/demo-mode';
import { DEMO_RESTRICTED_MESSAGE } from '../src/demo/demo-restricted.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signIn, signUp, uniqueEmail } from './helpers/auth';
import { resetDatabase } from './helpers/db';

const ONE_MEBIBYTE = 1024 * 1024;

/**
 * A sign-in body of exactly `bytes` bytes: real credentials plus a `padding` field Better Auth's
 * schema strips. Sent as a string so the `Content-Length` is the number under test and not
 * whatever superagent's serialiser happens to produce.
 */
function signInBodyOfSize(email: string, password: string, bytes: number): string {
  const frame = JSON.stringify({ email, password, padding: '' });
  const room = bytes - Buffer.byteLength(frame);
  if (room < 0) throw new Error(`a ${bytes}-byte body cannot hold the credentials`);
  return JSON.stringify({ email, password, padding: 'x'.repeat(room) });
}

type StreamOutcome = { kind: 'response'; status: number } | { kind: 'error'; code?: string };

/**
 * POSTs `totalBytes` of body with `Transfer-Encoding: chunked` and no `Content-Length`, the one
 * shape the mount cannot refuse from the headers alone, straight over `node:http` because
 * superagent always declares a length for the bodies it is given.
 */
function streamChunkedBody(
  server: Server,
  path: string,
  totalBytes: number,
): Promise<StreamOutcome> {
  const { address, port } = server.address() as AddressInfo;
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: address,
        port,
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ kind: 'response', status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => resolve({ kind: 'error', code: error.code }));

    const chunk = Buffer.alloc(16 * 1024, 'x');
    let sent = 0;
    req.write('{"email":"nobody@test.example.com","password":"');
    const pump = (): void => {
      while (sent < totalBytes) {
        sent += chunk.length;
        if (!req.write(chunk)) {
          req.once('drain', pump);
          return;
        }
      }
      req.end('"}');
    };
    pump();
  });
}

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

  /**
   * The `/auth/*` body ceiling (`AUTH_BODY_MAX_BYTES`), against the real mount and a real
   * socket. `src/auth/auth-body-limit.spec.ts` covers the arithmetic; what only this file can
   * show is that the check runs ahead of Better Auth's own reader without starving it.
   */
  describe('the request body ceiling', () => {
    /**
     * A sign-in request carrying `bytes` of body over a connection the client means to keep.
     *
     * `Connection: keep-alive` is set by hand because superagent asks for `Connection: close`
     * on every request, and that turns an early refusal into a race the assertion loses roughly
     * one run in ten. Node closes a socket the moment a response finishes on a connection the
     * client asked to close, so the megabyte still in flight is met by a reset and the client
     * reports `write ECONNRESET` instead of reading the `413` the server had already written.
     * On a kept connection Node pulls the rest of the body off the wire and discards it, and
     * the response is always readable. Every real caller (a browser, `fetch`, curl) keeps the
     * connection, so this is the ordinary case and not a workaround. The refusal itself is
     * identical either way: it is written from the headers, before a byte of the body is read.
     */
    function postSignIn(email: string, password: string, bytes: number): request.Test {
      return request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .set('Content-Type', 'application/json')
        .set('Connection', 'keep-alive')
        .send(signInBodyOfSize(email, password, bytes));
    }

    it('refuses a 1 MiB body with the standard 413 envelope, before Better Auth reads it', async () => {
      const user = await signUp(app);
      const sessionsBefore = await prisma.session.count();

      const response = await postSignIn(user.email, user.password, ONE_MEBIBYTE).expect(413);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: REQUEST_BODY_TOO_LARGE_MESSAGE,
        path: '/auth/sign-in/email',
        timestamp: expect.any(String),
        requestId: expect.stringMatching(UUID_V7_REGEX),
      });
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
      // Refused from the headers, so the valid credentials inside were never read: no session.
      expect(response.headers['set-cookie']).toBeUndefined();
      await expect(prisma.session.count()).resolves.toBe(sessionsBefore);
    });

    it('is a strict ceiling: exactly AUTH_BODY_MAX_BYTES signs in, one byte more is refused', async () => {
      // The boundary is what the proxy row is held to (`two-layer-limit.spec.ts`): a body Caddy
      // lets through at `max_size` must be a body the API accepts.
      const user = await signUp(app);

      const atCeiling = await postSignIn(user.email, user.password, AUTH_BODY_MAX_BYTES).expect(
        200,
      );
      expect(atCeiling.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('better-auth.session_token=')]),
      );

      await postSignIn(user.email, user.password, AUTH_BODY_MAX_BYTES + 1).expect(413);
    });

    it('cuts a chunked body past the ceiling and keeps serving afterwards', async () => {
      const user = await signUp(app);

      // No `Content-Length` to refuse up front, so the guard counts as Better Auth reads and
      // closes the connection: the client gets no response at all, not a late 200.
      const outcome = await streamChunkedBody(
        app.getHttpServer(),
        '/auth/sign-in/email',
        ONE_MEBIBYTE,
      );
      expect(outcome.kind).toBe('error');

      // The cut is per request. The process is intact and the route answers the next caller.
      const agent = await signIn(app, user.email, user.password);
      await agent.get('/me').expect(200);
    });
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
