import { Controller, Get, INestApplication, Logger, Post, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { seconds, Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { throttlerOptions } from './rate-limit/rate-limit';
import {
  configureTrustProxy,
  resolveTrustProxySetting,
  RESOLVED_CLIENT_IP_HEADER,
} from './trust-proxy';

/** Ceiling small enough that a five-request test proves the boundary without being slow. */
const PROBE_LIMIT = 2;

/**
 * Exposes what the app resolved for this request — `req.ip` and the header Better Auth is
 * configured to trust — plus one throttled route. Real controllers never do this; it exists so
 * the suite can assert on resolution instead of only on pass/fail request counts.
 */
@Controller()
class ProbeController {
  @Get('probe')
  probe(@Req() req: Request): { ip: string | undefined; resolvedHeader: string | undefined } {
    return {
      ip: req.ip,
      resolvedHeader: req.headers[RESOLVED_CLIENT_IP_HEADER] as string | undefined,
    };
  }

  @Post('limited')
  @Throttle({ default: { limit: PROBE_LIMIT, ttl: seconds(60) } })
  limited(): { ok: true } {
    return { ok: true };
  }
}

describe('trust proxy', () => {
  let app: INestApplication<App>;

  /**
   * Builds a real Nest HTTP app wired the same way `AppModule` is — `ThrottlerGuard` as an
   * `APP_GUARD` reading `throttlerOptions()` — then applies `configureTrustProxy` the same way
   * `configureApp` does. `ProbeController` stands in for the real controllers (as
   * `rate-limit/throttler-guard.spec.ts` already does) so this suite never needs Better Auth or
   * a database, but every layer between an inbound request and `req.ip` is the production one.
   */
  async function createApp(setting: boolean | number | string): Promise<INestApplication<App>> {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions())],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    const created = moduleRef.createNestApplication<App>();
    created.useGlobalFilters(new AllExceptionsFilter());
    configureTrustProxy(created, setting);
    await created.init();

    return created;
  }

  afterEach(async () => {
    await app?.close();
  });

  describe('resolveTrustProxySetting', () => {
    it('treats unset/blank as off', () => {
      expect(resolveTrustProxySetting('')).toBe(false);
      expect(resolveTrustProxySetting('   ')).toBe(false);
    });

    it('parses "false" case-insensitively as off', () => {
      expect(resolveTrustProxySetting('false')).toBe(false);
      expect(resolveTrustProxySetting('False')).toBe(false);
      expect(resolveTrustProxySetting('FALSE')).toBe(false);
    });

    it('parses "true" case-insensitively as trust-everything', () => {
      expect(resolveTrustProxySetting('true')).toBe(true);
      expect(resolveTrustProxySetting('True')).toBe(true);
    });

    it('parses a bare integer as a hop count', () => {
      expect(resolveTrustProxySetting('1')).toBe(1);
      expect(resolveTrustProxySetting('2')).toBe(2);
      expect(resolveTrustProxySetting('0')).toBe(0);
    });

    it('passes an IP/CIDR list through verbatim for proxy-addr to compile', () => {
      expect(resolveTrustProxySetting('10.0.0.0/8,172.16.0.1')).toBe('10.0.0.0/8,172.16.0.1');
    });

    it('passes an express/proxy-addr preset through verbatim', () => {
      expect(resolveTrustProxySetting('loopback')).toBe('loopback');
    });

    it('trims surrounding whitespace before classifying the value', () => {
      expect(resolveTrustProxySetting('  1  ')).toBe(1);
      expect(resolveTrustProxySetting('  true  ')).toBe(true);
    });
  });

  describe('configureTrustProxy', () => {
    it('warns at boot when the setting trusts the entire forwarded chain', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      app = await createApp(true);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TRUST_PROXY=true'));
      warnSpy.mockRestore();
    });

    it('does not warn for the safe default', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      app = await createApp(false);

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('TRUST_PROXY'));
      warnSpy.mockRestore();
    });
  });

  describe('with trust proxy off (the default)', () => {
    beforeEach(async () => {
      app = await createApp(false);
    });

    it('ignores a spoofed X-Forwarded-For — every request resolves to the same real peer', async () => {
      const first = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '1.2.3.4')
        .expect(200);
      const second = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '9.9.9.9')
        .expect(200);

      expect(first.body.ip).toBe(second.body.ip);
      expect(first.body.ip).not.toBe('1.2.3.4');
      expect(second.body.ip).not.toBe('9.9.9.9');
    });

    it('stamps the resolved-client-ip header from the socket, not from a client-supplied value', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe')
        .set(RESOLVED_CLIENT_IP_HEADER, '6.6.6.6')
        .expect(200);

      expect(response.body.resolvedHeader).toBeDefined();
      expect(response.body.resolvedHeader).not.toBe('6.6.6.6');
      expect(response.body.resolvedHeader).toBe(response.body.ip);
    });

    it('does not let a rotating X-Forwarded-For split or reset the throttle budget', async () => {
      // Every one of these "different clients" is, without a trusted proxy in front, the same
      // client as far as the app can prove — so they must share one budget. This is the test
      // whose failure would mean spoofing bypasses the rate limit.
      for (let attempt = 0; attempt < PROBE_LIMIT; attempt += 1) {
        await request(app.getHttpServer())
          .post('/limited')
          .set('X-Forwarded-For', `10.0.0.${attempt}`)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/limited')
        .set('X-Forwarded-For', '10.0.0.99')
        .expect(429);
    });
  });

  describe('with trust proxy on (hop count 1 — one reverse proxy in front of the app)', () => {
    beforeEach(async () => {
      app = await createApp(1);
    });

    it('resolves req.ip from a single-value X-Forwarded-For', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.9')
        .expect(200);

      expect(response.body.ip).toBe('203.0.113.9');
    });

    it('stamps the resolved-client-ip header with the XFF-derived address, overwriting a client-supplied one', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.9')
        .set(RESOLVED_CLIENT_IP_HEADER, '6.6.6.6')
        .expect(200);

      expect(response.body.resolvedHeader).toBe('203.0.113.9');
    });

    it('throttles two different forwarded clients independently', async () => {
      for (let attempt = 0; attempt < PROBE_LIMIT; attempt += 1) {
        await request(app.getHttpServer())
          .post('/limited')
          .set('X-Forwarded-For', '198.51.100.1')
          .expect(201);
      }
      await request(app.getHttpServer())
        .post('/limited')
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(429);

      // A second, distinct forwarded client has its own untouched budget.
      await request(app.getHttpServer())
        .post('/limited')
        .set('X-Forwarded-For', '198.51.100.2')
        .expect(201);
    });

    it('counts repeated requests from the same forwarded client toward one shared budget', async () => {
      for (let attempt = 0; attempt < PROBE_LIMIT; attempt += 1) {
        await request(app.getHttpServer())
          .post('/limited')
          .set('X-Forwarded-For', '198.51.100.5')
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/limited')
        .set('X-Forwarded-For', '198.51.100.5')
        .expect(429);
    });
  });
});
