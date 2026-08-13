import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

describe('configureApp security headers', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { corsOrigin: 'http://localhost:3000' });
    await app.init();
  });

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
});
