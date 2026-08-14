import { Body, Controller, Delete, Get, INestApplication, Patch, Post, Put } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

// Same stand-in as `configure-app.spec.ts`: Better Auth is ESM-only and opens a database
// connection the moment `../auth/auth` is imported. What matters to this suite is only that
// *something* claims the raw Express route below the Nest router (ADR 0004), because the
// origin check has to cover that mount and no Nest guard could.
jest.mock('../auth/mount-better-auth', () => ({
  mountBetterAuth: (app: INestApplication) => {
    const expressApp = app.getHttpAdapter().getInstance() as {
      all: (
        path: string,
        handler: (
          req: unknown,
          res: { status: (code: number) => { json: (b: unknown) => void } },
        ) => void,
      ) => void;
    };
    expressApp.all('/auth/{*splat}', (_req, res) => {
      res.status(200).json({ mounted: true });
    });
  },
}));

// Imported below the mock: pulling in configureApp loads ../auth/mount-better-auth.
import { configureApp } from './configure-app';
import { claimedOrigin, normalizeOrigin, resolveAllowedOrigins } from './origin-check';

const WEB_ORIGIN = 'http://localhost:3000';
const EVIL_ORIGIN = 'https://evil.example';

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  create(@Body() body: Record<string, unknown>): { created: true; body: Record<string, unknown> } {
    return { created: true, body };
  }

  @Put()
  replace(): { ok: true } {
    return { ok: true };
  }

  @Patch()
  update(): { ok: true } {
    return { ok: true };
  }

  @Delete()
  remove(): { ok: true } {
    return { ok: true };
  }
}

describe('normalizeOrigin', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000'],
    // A trailing slash, a path, and a query are all things an operator writes into WEB_URL
    // (it is also the base for links in outgoing mail), and none of them appear in the header
    // a browser sends.
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['https://kurultay.example.com/app?x=1', 'https://kurultay.example.com'],
    // The scheme's default port is omitted from the serialised origin, so both spellings of
    // the same deployment resolve to the one string the browser will send.
    ['https://kurultay.example.com:443', 'https://kurultay.example.com'],
    ['http://kurultay.example.com:80', 'http://kurultay.example.com'],
    ['HTTPS://Kurultay.Example.COM', 'https://kurultay.example.com'],
  ])('reduces %s to the origin a browser would send: %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it('refuses a value that is not a URL, rather than yielding an allowlist nothing matches', () => {
    expect(() => normalizeOrigin('kurultay.example.com')).toThrow(/not a valid origin url/i);
  });

  it.each([
    // A scheme-less `host:port` parses — as a URL whose scheme is `localhost:` — and
    // serialises to the opaque origin. It is the likeliest WEB_URL typo, so it gets a
    // startup failure rather than an allowlist that silently matches nothing.
    'localhost:3000',
    'data:text/plain,hi',
  ])('refuses %s, whose origin would allowlist every opaque document', (value) => {
    expect(() => normalizeOrigin(value)).toThrow(/no usable origin/i);
  });

  it('derives the allowlist from the one configured web origin', () => {
    expect(resolveAllowedOrigins('http://localhost:3000/')).toEqual(['http://localhost:3000']);
  });
});

describe('claimedOrigin', () => {
  function req(headers: Record<string, string | undefined>): Parameters<typeof claimedOrigin>[0] {
    return { headers } as unknown as Parameters<typeof claimedOrigin>[0];
  }

  it('prefers Origin over Referer when both are present', () => {
    expect(claimedOrigin(req({ origin: EVIL_ORIGIN, referer: `${WEB_ORIGIN}/board/1` }))).toBe(
      EVIL_ORIGIN,
    );
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(claimedOrigin(req({ referer: `${EVIL_ORIGIN}/attack.html` }))).toBe(EVIL_ORIGIN);
  });

  it('reports no claim when neither header is present', () => {
    expect(claimedOrigin(req({}))).toBeNull();
  });

  it('reports no claim for a malformed Referer, which no browser sends', () => {
    expect(claimedOrigin(req({ referer: 'not a url' }))).toBeNull();
  });
});

describe('origin check middleware', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: WEB_ORIGIN, trustProxy: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('rejects', () => {
    it('a cross-site POST carrying a foreign Origin', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe')
        .set('Origin', EVIL_ORIGIN)
        .send({ name: 'csrf' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Cross-origin state-changing request rejected',
        path: '/probe',
      });
      // The rejection must not name the allowlist — see the comment on the response body.
      expect(JSON.stringify(response.body)).not.toContain(WEB_ORIGIN);
    });

    it('a form-encoded cross-site POST — the shape no CORS preflight ever sees', async () => {
      // The vector this middleware exists for: `application/x-www-form-urlencoded` makes the
      // request "simple", so the browser sends it without asking CORS anything at all. Nest's
      // Express adapter parses the body regardless, so before this check the write landed.
      await request(app.getHttpServer())
        .post('/probe')
        .set('Origin', EVIL_ORIGIN)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('name=csrf')
        .expect(403);
    });

    it('an opaque `Origin: null` from a sandboxed document or a laundering redirect', async () => {
      await request(app.getHttpServer())
        .post('/probe')
        .set('Origin', 'null')
        .send({ name: 'csrf' })
        .expect(403);
    });

    it('a foreign Referer when the request announces no Origin', async () => {
      await request(app.getHttpServer())
        .post('/probe')
        .set('Referer', `${EVIL_ORIGIN}/attack.html`)
        .send({ name: 'csrf' })
        .expect(403);
    });

    it.each(['put', 'patch', 'delete'] as const)(
      'a cross-site %s — every state-changing method, not just POST',
      async (method) => {
        await request(app.getHttpServer())[method]('/probe').set('Origin', EVIL_ORIGIN).expect(403);
      },
    );

    it('a cross-site POST to the Better Auth mount, which bypasses the Nest router', async () => {
      // Better Auth's own `originCheck` guards redirect targets, not the credential endpoints:
      // measured against the unprotected build, `POST /auth/sign-in/email` and
      // `POST /auth/sign-out` both answered 200 to a foreign Origin. A Nest guard could not
      // have covered them at all (ADR 0004), which is why this is a middleware.
      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .set('Origin', EVIL_ORIGIN)
        .send({ email: 'a@b.test', password: 'x' })
        .expect(403);
    });

    it('and still returns the correlation id, so a rejection is traceable to a log line', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe')
        .set('Origin', EVIL_ORIGIN)
        .set('X-Request-Id', 'origin-check-probe-1')
        .expect(403);

      expect(response.headers['x-request-id']).toBe('origin-check-probe-1');
      expect(response.body.requestId).toBe('origin-check-probe-1');
    });
  });

  describe('allows', () => {
    it('a POST from the configured web origin', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe')
        .set('Origin', WEB_ORIGIN)
        .send({ name: 'legit' })
        .expect(201);

      expect(response.body).toMatchObject({ created: true });
    });

    it('a POST from a client that announces nothing — curl, CI, a native app', async () => {
      // Deliberate: no browser can be induced to make a cross-site request that carries the
      // victim's cookie *and* omits Origin, so refusing this case would break every
      // non-browser caller while closing nothing.
      await request(app.getHttpServer()).post('/probe').send({ name: 'script' }).expect(201);
    });

    it('a POST whose Referer is the web app, Origin absent', async () => {
      await request(app.getHttpServer())
        .post('/probe')
        .set('Referer', `${WEB_ORIGIN}/board/1`)
        .send({ name: 'legit' })
        .expect(201);
    });

    it('a cross-origin GET — a read the browser already gates through CORS', async () => {
      // Blocking this would break the Socket.io handshake, which is a GET carrying the web
      // app's Origin and is governed by the gateway's own CORS config.
      await request(app.getHttpServer()).get('/probe').set('Origin', EVIL_ORIGIN).expect(200);
    });

    it('a preflight OPTIONS, which the CORS middleware answers ahead of this check', async () => {
      const response = await request(app.getHttpServer())
        .options('/probe')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBeLessThan(300);
      expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    });

    it('a same-origin POST written with a trailing slash in WEB_URL', async () => {
      // `resolveAllowedOrigins` normalises the configured value, so the exact spelling an
      // operator used does not decide whether their own app can write.
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();
      const slashApp = moduleRef.createNestApplication<App>();
      configureApp(slashApp, { corsOrigin: `${WEB_ORIGIN}/`, trustProxy: false });
      await slashApp.init();

      await request(slashApp.getHttpServer())
        .post('/probe')
        .set('Origin', WEB_ORIGIN)
        .send({ name: 'legit' })
        .expect(201);

      await slashApp.close();
    });
  });
});
