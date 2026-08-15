import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  OPENAPI_JSON_PATH,
  OPENAPI_UI_PATH,
  openApiDocsEnabled,
  serveOpenApi,
} from './serve-openapi';

/**
 * These assertions pin a **decision**, not an implementation.
 *
 * `/docs` is an unauthenticated HTML surface with a request console attached, published by an
 * API that people self-host without choosing it. Off in production is the answer this project
 * arrived at, and the reasoning is on `openApiDocsEnabled`. Flipping the default is allowed —
 * it is a decision, and decisions change — but it must be a decision, so it has to break a test
 * that says what it costs rather than slipping through as a one-character diff.
 */
describe('openApiDocsEnabled', () => {
  // Two keys are saved and restored individually rather than the whole of `process.env` being
  // swapped out. Reassigning `process.env` replaces the object every other module in this
  // worker already closed over, which is a much larger blast radius than the two variables
  // under test — and `NODE_ENV` in particular is read by `isTestEnv()`.
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDocsEnabled = process.env.API_DOCS_ENABLED;

  function restore(key: 'NODE_ENV' | 'API_DOCS_ENABLED', value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  }

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('API_DOCS_ENABLED', originalDocsEnabled);
  });

  it('is on when NODE_ENV is not production', () => {
    delete process.env.API_DOCS_ENABLED;
    process.env.NODE_ENV = 'development';

    expect(openApiDocsEnabled()).toBe(true);
  });

  it('is off under NODE_ENV=production unless an operator asks for it', () => {
    delete process.env.API_DOCS_ENABLED;
    process.env.NODE_ENV = 'production';

    expect(openApiDocsEnabled()).toBe(false);
  });

  it('is on in production when API_DOCS_ENABLED says so', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_DOCS_ENABLED = 'true';

    expect(openApiDocsEnabled()).toBe(true);
  });

  it('can be switched off outside production too', () => {
    process.env.NODE_ENV = 'development';
    process.env.API_DOCS_ENABLED = 'false';

    expect(openApiDocsEnabled()).toBe(false);
  });

  it('refuses a value that is not a boolean rather than guessing', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_DOCS_ENABLED = 'maybe';

    // `envBool` throws on an unrecognised spelling for the same reason every other variable
    // does: `Boolean('false')` is `true`, and a lenient reading here would publish a console on
    // an instance whose operator wrote something they believed meant "no".
    expect(() => openApiDocsEnabled()).toThrow(/API_DOCS_ENABLED/);
  });
});

/** Stands in for `HealthController`, whose two paths the document's own guard requires. */
@Controller('health')
class StubHealthController {
  @Get()
  check(): string {
    return 'ok';
  }

  @Get('ready')
  ready(): string {
    return 'ok';
  }
}

/**
 * The decision above is only worth pinning if the switch it describes actually moves something,
 * so these exercise the mount itself rather than the predicate.
 *
 * Two things here are checked nowhere else in the suite. The **Content-Security-Policy
 * exception** is the one hole this feature opens in a service that is otherwise
 * `default-src 'none'`, and it is per-path — a regression that widened it, or that dropped it
 * and left the console blank, would break nothing else. And the **disabled** case has to be
 * genuinely unmounted rather than merely unreachable: a route that exists and answers 403 is a
 * different promise from one that was never registered.
 */
describe('serveOpenApi', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDocsEnabled = process.env.API_DOCS_ENABLED;

  async function bootWith(docsEnabled: string): Promise<INestApplication> {
    process.env.API_DOCS_ENABLED = docsEnabled;
    const moduleRef = await Test.createTestingModule({
      controllers: [StubHealthController],
    }).compile();
    const app = moduleRef.createNestApplication();
    // `serveOpenApi` before `init`, exactly as `main.ts` orders it.
    serveOpenApi(app);
    await app.init();

    return app;
  }

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalDocsEnabled === undefined) {
      delete process.env.API_DOCS_ENABLED;
    } else {
      process.env.API_DOCS_ENABLED = originalDocsEnabled;
    }
  });

  describe('when enabled', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootWith('true');
    });

    afterAll(async () => {
      await app.close();
      delete process.env.API_DOCS_ENABLED;
    });

    it('serves the console as HTML', async () => {
      const response = await request(app.getHttpServer()).get(`/${OPENAPI_UI_PATH}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
    });

    it('relaxes the content-security-policy on the console, and only so far', async () => {
      const response = await request(app.getHttpServer()).get(`/${OPENAPI_UI_PATH}`);
      const policy = response.headers['content-security-policy'];

      // Swagger UI is a document with an inline style block and its own bundles. Under the
      // API-wide `default-src 'none'` every one of them is refused and the page renders blank.
      expect(policy).toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).toContain("style-src 'self' 'unsafe-inline'");
      // What the exception does **not** buy: nothing off-origin loads, nothing may frame the
      // console, and no `<base>` or form target can be smuggled into it.
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("base-uri 'none'");
      expect(policy).toContain("form-action 'none'");
    });

    it('serves the document as JSON, with the paths the guard demanded', async () => {
      const response = await request(app.getHttpServer()).get(`/${OPENAPI_JSON_PATH}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(response.body.paths)).toEqual(
        expect.arrayContaining(['/health', '/health/ready']),
      );
    });

    it('needs no session for either — that is the point of the decision above', async () => {
      // No cookie is sent by any request in this describe block. Both answered 200, which is
      // what makes the production default worth having.
      const ui = await request(app.getHttpServer()).get(`/${OPENAPI_UI_PATH}`);
      const json = await request(app.getHttpServer()).get(`/${OPENAPI_JSON_PATH}`);

      expect([ui.status, json.status]).toEqual([200, 200]);
    });
  });

  describe('when disabled', () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = 'production';
      app = await bootWith('false');
    });

    afterAll(async () => {
      await app.close();
    });

    it('registers nothing at all, rather than registering something that refuses', async () => {
      const ui = await request(app.getHttpServer()).get(`/${OPENAPI_UI_PATH}`);
      const json = await request(app.getHttpServer()).get(`/${OPENAPI_JSON_PATH}`);

      expect([ui.status, json.status]).toEqual([404, 404]);
    });

    it('leaves the rest of the application untouched', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });
});
