import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 without a session', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  /**
   * The suite runs against a live test database, so the database probe has to report `up`.
   * Redis is asserted as "not down" rather than "up": CI provides one (`REDIS_URL` set), while
   * a local run may have none, and a deployment without Redis reports `skipped` — a supported
   * configuration, not a failure. See `HealthService.probeRedis`.
   */
  it('GET /health/ready probes dependencies without a session', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.body.checks.database).toBe('up');
    expect(response.body.checks.redis).not.toBe('down');
    expect(response.body.status).toBe('ok');
    expect(response.status).toBe(200);
  });
});
