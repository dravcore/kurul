import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from '../../health/health.controller';
import { HealthService } from '../../health/health.service';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import {
  INVITATION_RATE_LIMIT,
  RATE_LIMIT_ERROR_MESSAGE,
  TASK_SEARCH_RATE_LIMIT,
  throttlerOptions,
  ThrottleInvitations,
  ThrottleTaskList,
} from './rate-limit';

/**
 * Stands in for the real controllers so this suite can exercise the policies without dragging
 * in Better Auth (which reaches for a live database on import). The decorators, the module
 * options and the guard registration are the production ones — only the handler bodies are
 * fake, so a change to any policy number shows up here.
 */
@Controller()
class ProbeController {
  @Post('invitations')
  @ThrottleInvitations()
  invite(): { ok: true } {
    return { ok: true };
  }

  @Get('tasks')
  @ThrottleTaskList()
  tasks(): { ok: true } {
    return { ok: true };
  }
}

/** The real readiness report, without the Postgres and Redis round trips behind it. */
const healthServiceStub = {
  checkReadiness: () =>
    Promise.resolve({ status: 'ok' as const, checks: { database: 'up' as const } }),
};

describe('ThrottlerGuard as a global guard', () => {
  const originalEnabled = process.env.RATE_LIMIT_ENABLED;
  let app: INestApplication<App>;

  /** Mirrors `AppModule`: the throttler is an APP_GUARD, registered ahead of everything else. */
  async function createApp(): Promise<INestApplication<App>> {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions())],
      // HealthController is the production class, not a stand-in: the exemption it carries is
      // what keeps a compose healthcheck from reporting a perfectly healthy API as down.
      controllers: [ProbeController, HealthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: HealthService, useValue: healthServiceStub },
      ],
    }).compile();

    const created = moduleRef.createNestApplication<App>();
    created.useGlobalFilters(new AllExceptionsFilter());
    await created.init();

    return created;
  }

  afterEach(async () => {
    await app?.close();
    if (originalEnabled === undefined) {
      delete process.env.RATE_LIMIT_ENABLED;
    } else {
      process.env.RATE_LIMIT_ENABLED = originalEnabled;
    }
  });

  describe('with rate limiting on', () => {
    beforeEach(async () => {
      delete process.env.RATE_LIMIT_ENABLED;
      app = await createApp();
    });

    it('answers the request that goes over an endpoint budget with 429', async () => {
      for (let attempt = 0; attempt < INVITATION_RATE_LIMIT; attempt += 1) {
        await request(app.getHttpServer()).post('/invitations').expect(201);
      }

      const blocked = await request(app.getHttpServer()).post('/invitations').expect(429);

      // The response goes through AllExceptionsFilter, so it is the same envelope as every
      // other error in `docs/api-conventions.md` rather than the raw ThrottlerException.
      expect(blocked.body).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        message: RATE_LIMIT_ERROR_MESSAGE,
        path: '/invitations',
      });
      // A client that wants to back off correctly needs to be told how long to wait.
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('advertises the remaining budget while a client is still under it', async () => {
      const first = await request(app.getHttpServer()).post('/invitations').expect(201);

      expect(first.headers['x-ratelimit-limit']).toBe(String(INVITATION_RATE_LIMIT));
      expect(first.headers['x-ratelimit-remaining']).toBe(String(INVITATION_RATE_LIMIT - 1));
    });

    /**
     * Parity for personal access tokens. The throttler is registered ahead of
     * `SessionAuthGuard` and keys on client IP and route, so it never learns which credential
     * a request carried: a script replaying a Bearer token spends the same budget as a browser
     * session, and the token requests and cookie requests from one address share it.
     */
    it('counts Bearer-token requests against the same per-IP budget as cookie requests', async () => {
      const half = Math.floor(INVITATION_RATE_LIMIT / 2);
      for (let attempt = 0; attempt < half; attempt += 1) {
        await request(app.getHttpServer())
          .post('/invitations')
          .set('Authorization', 'Bearer kurul_pat_rate_limit_probe')
          .expect(201);
      }
      for (let attempt = half; attempt < INVITATION_RATE_LIMIT; attempt += 1) {
        await request(app.getHttpServer()).post('/invitations').expect(201);
      }

      const blocked = await request(app.getHttpServer())
        .post('/invitations')
        .set('Authorization', 'Bearer kurul_pat_rate_limit_probe')
        .expect(429);
      expect(blocked.body).toMatchObject({ statusCode: 429, message: RATE_LIMIT_ERROR_MESSAGE });
    });

    it('holds task search to the tighter ceiling', async () => {
      for (let attempt = 0; attempt < TASK_SEARCH_RATE_LIMIT; attempt += 1) {
        await request(app.getHttpServer()).get('/tasks').query({ q: 'invoice' }).expect(200);
      }

      await request(app.getHttpServer()).get('/tasks').query({ q: 'invoice' }).expect(429);
    });

    it('lets ordinary board paging past the search ceiling on the same handler', async () => {
      for (let attempt = 0; attempt <= TASK_SEARCH_RATE_LIMIT; attempt += 1) {
        await request(app.getHttpServer()).get('/tasks').expect(200);
      }
    });

    it.each(['/health', '/health/ready'])('never throttles %s', async (path) => {
      for (let attempt = 0; attempt <= INVITATION_RATE_LIMIT * 2; attempt += 1) {
        await request(app.getHttpServer()).get(path).expect(200);
      }

      const response = await request(app.getHttpServer()).get(path).expect(200);
      // Exempt means exempt: no budget is tracked for it at all.
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });

  describe('with RATE_LIMIT_ENABLED=false', () => {
    beforeEach(async () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      app = await createApp();
    });

    it('lets integration suites past every budget', async () => {
      for (let attempt = 0; attempt <= INVITATION_RATE_LIMIT * 2; attempt += 1) {
        await request(app.getHttpServer()).post('/invitations').expect(201);
      }
    });
  });
});
