import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { diskStorage, memoryStorage } from 'multer';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import {
  configureApp,
  DEFAULT_REQUEST_BODY_MAX_BYTES,
  resolveRequestBodyMaxBytes,
} from './configure-app';
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

/** Echoes back how many keys the parsed body had, so "the handler ran" is observable. */
const echoHandler = jest.fn();

@Controller('probe')
class EchoProbeController {
  @Post('echo')
  echo(@Body() payload: Record<string, unknown>): { keys: number } {
    echoHandler(payload);
    return { keys: Object.keys(payload ?? {}).length };
  }
}

/** A JSON document whose serialised form is exactly `bytes` bytes of ASCII. */
function jsonOfBytes(bytes: number): string {
  const overhead = JSON.stringify({ pad: '' }).length;
  return JSON.stringify({ pad: 'x'.repeat(bytes - overhead) });
}

/** A urlencoded body of exactly `bytes` bytes. */
function formOfBytes(bytes: number): string {
  return `pad=${'x'.repeat(bytes - 'pad='.length)}`;
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

  /**
   * The half of `origin-check.ts`'s `GET` exemption that lives here rather than there.
   *
   * A `GET` is outside `UNSAFE_METHODS`, so a foreign origin is answered `200` — and that is
   * only safe because the response never names the caller. `enableCors` is given a single
   * origin *string*, so the header is a constant rather than a reflection of `Origin`; the
   * browser compares the two, finds them different, and refuses to hand the body to the calling
   * script. Reflecting the requester (or emitting `*`) would keep this test's status code and
   * quietly turn every authenticated `GET` — the attachment byte stream included — into a
   * cross-origin read.
   */
  it('never echoes a foreign origin back on a GET it lets through', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe')
      .set('Origin', 'https://evil.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
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

/**
 * The same ordering, asked of the filesystem instead of the status code.
 *
 * The block above proves the *handler* never ran; that is one step short of what the upload path
 * needs, because multer buffers the whole part before the handler is called either way. What has
 * to be true is that no byte of a rejected body is ever buffered at all — the reason the origin
 * check being registered ahead of the body parser is load-bearing rather than tidy.
 *
 * `memoryStorage()` cannot answer that question: its buffer leaves no trace to look for.
 * `diskStorage()` can, and it is the same multer with a different sink — it writes its temp file
 * as soon as it starts reading the file part, well before the handler. So "the destination
 * directory is empty" is direct evidence that the reject happened before any buffering, and the
 * control below shows the same request from an allowed origin really does leave a file there.
 * Without that control this suite would pass on a build where multer was never wired up.
 */
describe('configureApp rejects a cross-origin upload before multer buffers it', () => {
  const BODY_BYTES = 4 * 1024 * 1024;
  let app: INestApplication<App>;
  let destination: string;
  let stdout: jest.SpyInstance;

  beforeAll(async () => {
    destination = await mkdtemp(join(tmpdir(), 'kurul-origin-buffer-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        // No `limits` on purpose: a 413 would end the request for a reason other than the one
        // under test, and the allowed-origin control has to be able to write the whole body.
        MulterModule.register({ storage: diskStorage({ destination }) }),
      ],
      controllers: [UploadProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: 'http://localhost:3000', trustProxy: false });
    await app.init();
  });

  beforeEach(async () => {
    uploadHandler.mockClear();
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    for (const entry of await readdir(destination)) {
      await rm(join(destination, entry), { force: true });
    }
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    await rm(destination, { recursive: true, force: true });
  });

  // The control. "Nothing was written" is only evidence if writing was reachable.
  it('writes the body to multer’s destination when the origin is allowed', async () => {
    await request(app.getHttpServer())
      .post('/probe/upload')
      .set('Origin', 'http://localhost:3000')
      .field('kind', 'FILE')
      .attach('file', Buffer.alloc(BODY_BYTES), 'big.png')
      .expect(201);

    expect(uploadHandler).toHaveBeenCalled();
    await expect(readdir(destination)).resolves.toHaveLength(1);
  });

  it('leaves the destination empty when the origin is not', async () => {
    // As above, the server answers and closes while supertest is still writing, so a connection
    // reset is a legitimate observation and only the *absence* of a stored file is asserted.
    const result = await request(app.getHttpServer())
      .post('/probe/upload')
      .set('Origin', 'https://evil.example')
      .field('kind', 'FILE')
      .attach('file', Buffer.alloc(BODY_BYTES), 'big.png')
      .then((response) => ({ status: response.status as number | null }))
      .catch(() => ({ status: null }));

    expect(result.status).not.toBe(201);
    expect(uploadHandler).not.toHaveBeenCalled();
    // Read after the socket has settled, so a file created late would still be seen.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(readdir(destination)).resolves.toEqual([]);
  });
});

/**
 * Issue #214. Nothing in this repository ever set a body-parser limit, so Express's own
 * **100 kB** default applied — a number nobody chose, written down nowhere, and reachable only
 * by measuring it. These two blocks make the limit a decision: the first pins the default the
 * project now owns, the second pins that an operator can move it.
 *
 * Both blocks assert through the whole stack rather than against the filter directly, because
 * the interesting claim is that a *real* `body-parser` failure has the shape
 * `AllExceptionsFilter` now recognises. A hand-built error could agree with the filter and
 * disagree with Express.
 */
describe('resolveRequestBodyMaxBytes', () => {
  const previous = process.env.REQUEST_BODY_MAX_BYTES;

  afterEach(() => {
    if (previous === undefined) delete process.env.REQUEST_BODY_MAX_BYTES;
    else process.env.REQUEST_BODY_MAX_BYTES = previous;
  });

  it('falls back to the documented default when unset', () => {
    delete process.env.REQUEST_BODY_MAX_BYTES;

    expect(resolveRequestBodyMaxBytes()).toBe(DEFAULT_REQUEST_BODY_MAX_BYTES);
    // Pinned as a literal as well as by name: `.env.example`, `docs/api-conventions.md` and
    // `docs/self-hosting.md` all quote this number, and a silent change to it would make three
    // documents wrong at once. P3-3 is expected to raise it — deliberately, with those.
    expect(DEFAULT_REQUEST_BODY_MAX_BYTES).toBe(1_048_576);
  });

  it('reads REQUEST_BODY_MAX_BYTES when it is set', () => {
    process.env.REQUEST_BODY_MAX_BYTES = '5242880';

    expect(resolveRequestBodyMaxBytes()).toBe(5_242_880);
  });

  // Both refusals fail the process at boot rather than answering 413 to every write.
  it('refuses a non-integer', () => {
    process.env.REQUEST_BODY_MAX_BYTES = '5mb';

    expect(() => resolveRequestBodyMaxBytes()).toThrow(/REQUEST_BODY_MAX_BYTES/);
  });

  it.each(['0', '-1'])('refuses %s — it would reject every request body', (raw) => {
    process.env.REQUEST_BODY_MAX_BYTES = raw;

    expect(() => resolveRequestBodyMaxBytes()).toThrow(/positive byte count/);
  });

  /**
   * The same drift check `storage/two-layer-limit.spec.ts` runs for `ATTACHMENT_MAX_BYTES`.
   *
   * A default that lives in three files is three chances to disagree, and the disagreement is
   * invisible: `.env.example` teaches the operator a number, the compose default is the one a
   * Compose install actually gets, and the constant here is what a bare `pnpm start` uses.
   * Reading the shipped files — rather than a copy of the number — is the point: a test with its
   * own duplicate would pass on the one day somebody edits `.env.example`.
   *
   * The compose row matters on its own. Without it an operator could set the variable in `.env`,
   * see it ignored, and be back to a limit that silently is not what the file says — the exact
   * defect class this variable was introduced to end.
   */
  it('is the same number in .env.example and in the compose default', () => {
    const repoRoot = join(__dirname, '..', '..', '..', '..');
    const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

    expect(/^REQUEST_BODY_MAX_BYTES=(\d+)$/m.exec(read('.env.example'))?.[1]).toBe(
      String(DEFAULT_REQUEST_BODY_MAX_BYTES),
    );
    expect(
      /REQUEST_BODY_MAX_BYTES:\s*\$\{REQUEST_BODY_MAX_BYTES:-(\d+)\}/.exec(
        read('docker-compose.yml'),
      )?.[1],
    ).toBe(String(DEFAULT_REQUEST_BODY_MAX_BYTES));
  });
});

describe('configureApp request body limit (default)', () => {
  /**
   * Comfortably over Express's unconfigured 100 kB and comfortably under the default this
   * project sets, so it is evidence about *which* of the two is in force.
   */
  const OVER_EXPRESS_DEFAULT = 150 * 1024;
  let app: INestApplication<App>;
  let stdout: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: 'http://localhost:3000', trustProxy: false });
    await app.init();
  });

  beforeEach(() => {
    echoHandler.mockClear();
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    logError.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a JSON body that an unconfigured Express would have refused', async () => {
    await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send(jsonOfBytes(OVER_EXPRESS_DEFAULT))
      .expect(201);

    expect(echoHandler).toHaveBeenCalled();
  });

  it('answers 413 in the ProblemDetails envelope once the default is exceeded', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send(jsonOfBytes(DEFAULT_REQUEST_BODY_MAX_BYTES + 4096))
      .expect(413);

    expect(response.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Request body is too large',
      path: '/probe/echo',
    });
    expect(response.body.requestId).toMatch(UUID_V7_REGEX);
    expect(response.headers['content-type']).toContain('application/json');
    expect(echoHandler).not.toHaveBeenCalled();
  });

  it('does not log the 413 as a failure, so nothing reaches error tracking', async () => {
    // `reportFailure` is the single call site that both logs and captures (see the note on it
    // in `all-exceptions.filter.ts`), so an absent `Logger.error` is a measurement of the
    // Sentry claim through the real stack — not a reading of the code.
    await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send(jsonOfBytes(DEFAULT_REQUEST_BODY_MAX_BYTES + 4096))
      .expect(413);

    expect(logError).not.toHaveBeenCalled();
  });
});

describe('configureApp request body limit (configured)', () => {
  /** Tiny on purpose: the property is that the option is honoured, not how big it is. */
  const LIMIT = 2048;
  let app: INestApplication<App>;
  let stdout: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, {
      corsOrigin: 'http://localhost:3000',
      trustProxy: false,
      bodyLimitBytes: LIMIT,
    });
    await app.init();
  });

  beforeEach(() => {
    echoHandler.mockClear();
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    logError.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  // The control. "A body over the limit is refused" says nothing unless a body under it is
  // accepted by the very same app — otherwise the assertion would still pass on a build that
  // refused every JSON body, or on one whose limit was a hundred times smaller than asked.
  it('accepts a JSON body just under the configured limit', async () => {
    await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send(jsonOfBytes(LIMIT - 1))
      .expect(201);

    expect(echoHandler).toHaveBeenCalled();
  });

  it('answers 413 for a JSON body over the configured limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send(jsonOfBytes(LIMIT * 4))
      .expect(413);

    expect(response.body).toMatchObject({ statusCode: 413, error: 'Payload Too Large' });
    expect(echoHandler).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  // The urlencoded parser is a second body parser with its own limit, and Nest registers it
  // with the same unconfigured default. Configuring only `json` would leave a 100 kB hole
  // behind a form-encoded POST.
  it('accepts a urlencoded body just under the configured limit', async () => {
    await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(formOfBytes(LIMIT - 1))
      .expect(201);

    expect(echoHandler).toHaveBeenCalled();
  });

  it('answers 413 for a urlencoded body over the configured limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(formOfBytes(LIMIT * 4))
      .expect(413);

    expect(response.body).toMatchObject({ statusCode: 413, error: 'Payload Too Large' });
    expect(echoHandler).not.toHaveBeenCalled();
  });

  /**
   * The neighbouring case that was *not* broken, pinned so the fix for #214 is not credited
   * with it and cannot quietly change it.
   *
   * A malformed JSON body comes out of the same parser, but Nest's own
   * `RoutesResolver.mapExternalException` converts every `SyntaxError` into a
   * `BadRequestException` before any filter sees it. So it was already a 400 and already
   * unreported — measured here rather than assumed, because "the parser's errors were 500s"
   * would have been the obvious and wrong generalisation to make from the issue.
   */
  it('leaves a malformed JSON body as the 400 Nest already made of it', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"pad": ')
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(logError).not.toHaveBeenCalled();
  });
});
