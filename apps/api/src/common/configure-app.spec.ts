import {
  Controller,
  Get,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { memoryStorage } from 'multer';
import request from 'supertest';
import { App } from 'supertest/types';

// Better Auth is ESM-only and reaches for a live database as soon as `../auth/auth` is
// imported. This suite is about the middleware stack configureApp installs, so the real mount
// is replaced by a stand-in that claims the same raw Express route the real one does. That
// keeps the interesting property under test: Better Auth bypasses the Nest router entirely
// (ADR 0004 escape hatch), so its responses only carry security headers if helmet was
// registered ahead of it.
const mountBetterAuth = jest.fn((app: INestApplication) => {
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, handler: (req: unknown, res: ExpressLikeResponse) => void) => void;
  };
  expressApp.all('/auth/{*splat}', (_req, res) => {
    res.status(200).json({ session: null });
  });
});
jest.mock('../auth/mount-better-auth', () => ({
  mountBetterAuth: (app: INestApplication) => mountBetterAuth(app),
}));

interface ExpressLikeResponse {
  status: (code: number) => ExpressLikeResponse;
  json: (body: unknown) => unknown;
}

// Imported below the mock on purpose: pulling in configureApp loads ../auth/mount-better-auth,
// so the factory above has to be registered — and `mountBetterAuth` assigned — first.
import { configureApp } from './configure-app';
import type { AccessLogLine } from './logging/access-log.middleware';
import { UUID_V7_REGEX } from './uuid';

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

/**
 * The size ceiling the multipart probe below is configured with.
 *
 * Deliberately tiny. The property under test is an *ordering* one, and a 25 MiB body would make
 * the suite slow for no extra evidence — what matters is that a body over the configured limit
 * exists, not how large the limit is.
 */
const PROBE_MAX_BYTES = 1024;

/** Records whether the multipart handler ran at all, so "rejected earlier" is observable. */
const uploadHandler = jest.fn();

@Controller('probe')
class UploadProbeController {
  /**
   * Stands in for `POST .../attachments`: a multipart route behind a size-limited multer.
   *
   * A stand-in rather than the real controller because the property is `configureApp`'s
   * middleware order, which is the same for every route the Nest router owns. Using a probe
   * keeps this suite free of the database, the session and the storage backend, none of which
   * participate in the ordering being pinned.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file?: { size: number }): { ok: true } {
    uploadHandler(file);
    return { ok: true };
  }
}

describe('configureApp security headers', () => {
  let app: INestApplication<App>;
  // The access log writes to stdout by default. Capturing it keeps the suite's output clean
  // and doubles as the assertion surface for the access-log tests below.
  let stdout: jest.SpyInstance;
  let logLines: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: 'http://localhost:3000', trustProxy: false });
    await app.init();
  });

  beforeEach(() => {
    logLines = [];
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logLines.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  /** The access-log line for the request just made, parsed. */
  function accessLog(): AccessLogLine {
    const lines = logLines.filter((line) => line.startsWith('{'));
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] ?? '{}') as AccessLogLine;
  }

  afterAll(async () => {
    await app.close();
  });

  it('still mounts Better Auth', () => {
    expect(mountBetterAuth).toHaveBeenCalledTimes(1);
  });

  it('sets the baseline security headers on a JSON response', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
    expect(response.headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(response.headers['origin-agent-cluster']).toBe('?1');
    // helmet neutralises the legacy XSS auditor rather than enabling it.
    expect(response.headers['x-xss-protection']).toBe('0');
  });

  it('sends an API-shaped CSP that forbids loading and framing anything', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);
    const csp = response.headers['content-security-policy'];

    expect(csp).toBeDefined();
    expect(csp.split(';').map((directive: string) => directive.trim())).toEqual(
      expect.arrayContaining([
        "default-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ]),
    );
    // No script/style allowance leaks in from helmet's browser-app defaults.
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('style-src');
  });

  it('sends HSTS with a one-year max-age covering subdomains', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('covers the Better Auth mount, which bypasses the Nest router', async () => {
    const response = await request(app.getHttpServer()).get('/auth/get-session').expect(200);

    expect(response.body).toEqual({ session: null });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('keeps CORS working for the configured web origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe')
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    // Cross-origin reads from the web app must not be blocked by CORP.
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  describe('request correlation', () => {
    it('mints a UUIDv7 request id and returns it in the response header', async () => {
      const response = await request(app.getHttpServer()).get('/probe').expect(200);

      expect(response.headers['x-request-id']).toMatch(UUID_V7_REGEX);
    });

    it('echoes a safe inbound X-Request-Id so an upstream trace survives', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Request-Id', 'edge-7f3a9c21b4d0')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('edge-7f3a9c21b4d0');
    });

    it('covers the Better Auth mount, which bypasses the Nest router', async () => {
      const response = await request(app.getHttpServer()).get('/auth/get-session').expect(200);

      expect(response.headers['x-request-id']).toMatch(UUID_V7_REGEX);
    });

    it('correlates the access-log line with the header the client received', async () => {
      const response = await request(app.getHttpServer()).get('/probe').expect(200);

      expect(accessLog().requestId).toBe(response.headers['x-request-id']);
    });
  });

  describe('access log', () => {
    it('writes one structured JSON line per request', async () => {
      await request(app.getHttpServer()).get('/probe').expect(200);

      expect(accessLog()).toMatchObject({
        level: 'info',
        method: 'GET',
        path: '/probe',
        status: 200,
      });
    });

    it('logs Better Auth traffic, which no Nest interceptor would see', async () => {
      await request(app.getHttpServer()).get('/auth/get-session').expect(200);

      expect(accessLog()).toMatchObject({
        method: 'GET',
        path: '/auth/get-session',
        status: 200,
      });
    });

    it('logs a 404 at warn level — a request the router never matched', async () => {
      await request(app.getHttpServer()).get('/nope').expect(404);

      expect(accessLog()).toMatchObject({ level: 'warn', path: '/nope', status: 404 });
    });

    it('keeps the query string out of the logged path', async () => {
      await request(app.getHttpServer()).get('/probe?q=salary%20review').expect(200);

      const line = logLines.filter((entry) => entry.startsWith('{')).join('');
      expect(line).not.toContain('salary');
      expect(accessLog().path).toBe('/probe');
    });
  });
});

/**
 * The origin check runs before the body is read — stated as behaviour, not as a middleware index.
 *
 * `multipart/form-data` is a CORS **simple request**: a cross-site `<form>` can POST one with no
 * preflight, so no CORS decision is ever made and the write would land before the browser
 * discarded a response the attacker never needed. The only layer that stops it is
 * `origin-check.ts`, and the only reason it stops it *before* megabytes have been buffered is
 * that `configureApp` runs between `create` and `listen`. Nothing declared that until this
 * block: it was a correct default nobody had written down.
 *
 * Express's internals are deliberately untouched. Express 5 removed `app._router`, and a test
 * that walks the layer array pins a name rather than a consequence. The consequence here is the
 * *absence* of `413`.
 */
describe('configureApp middleware order', () => {
  let app: INestApplication<App>;
  let stdout: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MulterModule.register({
          storage: memoryStorage(),
          limits: { fileSize: PROBE_MAX_BYTES, files: 1, fields: 8 },
        }),
      ],
      controllers: [UploadProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: 'http://localhost:3000', trustProxy: false });
    await app.init();
  });

  beforeEach(() => {
    uploadHandler.mockClear();
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  // The control. Without it the assertion below would pass on a build where multer has no limit
  // at all — "never answers 413" is only evidence if a 413 is reachable in the first place.
  it('answers 413 for an oversized upload that the origin check lets through', async () => {
    await request(app.getHttpServer())
      .post('/probe/upload')
      .attach('file', Buffer.alloc(PROBE_MAX_BYTES * 4), 'big.png')
      .expect(413);
  });

  it('rejects a cross-origin multipart POST with the origin check, not a body error', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/upload')
      .set('Origin', 'https://evil.example')
      .field('kind', 'FILE')
      .attach('file', Buffer.alloc(64), 'small.png')
      .expect(403);

    // The hand-written envelope from `origin-check.ts`, not `AllExceptionsFilter`'s — which is
    // itself evidence about *which* layer answered.
    expect(response.body.message).toBe('Cross-origin state-changing request rejected');
    expect(uploadHandler).not.toHaveBeenCalled();
  });

  it('never answers 413 for an oversized cross-origin upload', async () => {
    // Multer turns an over-limit body into `LIMIT_FILE_SIZE` → 413. If the body were read before
    // the origin was judged, this request would be a 413. What the ordering guarantees is
    // therefore the *absence* of 413 — and that is what this asserts, rather than the presence
    // of 403: the server answers and closes while supertest is still writing, so the client can
    // legitimately observe a connection reset instead of ever reading the 403 body. Requiring
    // 403 here would make the test flaky for a reason unrelated to the property.
    const result = await request(app.getHttpServer())
      .post('/probe/upload')
      .set('Origin', 'https://evil.example')
      .field('kind', 'FILE')
      .attach('file', Buffer.alloc(PROBE_MAX_BYTES * 4), 'big.png')
      .then((response) => ({ status: response.status as number | null }))
      .catch(() => ({ status: null }));

    // 403, or the connection closed under us. Never 413, and never a created attachment.
    expect(result.status).not.toBe(413);
    expect(result.status).not.toBe(201);
    expect(result.status).not.toBe(200);
    expect(uploadHandler).not.toHaveBeenCalled();
  });
});
