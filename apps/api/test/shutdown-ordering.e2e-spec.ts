import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app';

/**
 * The shutdown contract, exercised end to end: on SIGTERM, Nest runs every `onModuleDestroy`
 * hook *before* it closes the HTTP listener, and only `onApplicationShutdown` afterwards
 * (@nestjs/core `NestApplicationContext.close`). Ending the shared pg pool from a destroy hook
 * therefore killed whatever was in flight when the signal landed, and a self-hoster's ordinary
 * `docker compose up -d` reported a handful of 500s to Sentry for no reason at all.
 *
 * `app.close()` runs exactly the same sequence the signal handler does, so it is the whole
 * shutdown under test here, not a stand-in for one.
 *
 * `/health/ready` is the request: it is public, unthrottled, and its database probe borrows a
 * connection from the shared pool, which is the resource whose early release is the bug.
 */
describe('Shutdown ordering (e2e)', () => {
  let app: INestApplication<App>;

  /**
   * Enough concurrent requests that some are still mid-probe when the shutdown starts, rather
   * than one request that might have finished inside the same tick.
   */
  const CONCURRENCY = 12;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    // `app.close()` is called by the test itself; a second call is a no-op guard for the case
    // where the test failed before reaching it.
    await app.close();
  });

  it('closes the listener before it ends the pool, and serves what was in flight', async () => {
    const server = app.getHttpServer() as unknown as Server;

    // Two observations, both taken from the real objects rather than from a spy on Nest:
    // when the listener stopped accepting, and when the shared pool was ended. The invariant
    // is the order between them, and it is deterministic - no timing slack involved.
    const order: string[] = [];
    server.once('close', () => order.push('listener-closed'));

    const database = await import('../src/prisma/database');
    const pool = database.getSharedPool();
    const endPool = pool.end.bind(pool);
    (pool as unknown as { end: () => Promise<void> }).end = () => {
      order.push('pool-ended');
      return endPool();
    };

    // Every request has reached the server before the shutdown begins. Without this the test
    // would be racing the connect, and a shutdown that started first would produce a refused
    // connection rather than the in-flight case this is about.
    let received = 0;
    const allReceived = new Promise<void>((resolve) => {
      server.on('request', () => {
        received += 1;
        if (received >= CONCURRENCY) resolve();
      });
    });

    // `.then(...)` and not the bare supertest `Test`: superagent does not send anything until
    // something subscribes, so an array of un-awaited `Test` objects is an array of requests
    // that have not been made, and `allReceived` below would wait forever.
    const inFlight = Array.from({ length: CONCURRENCY }, () =>
      request(server)
        .get('/health/ready')
        .then((response) => response),
    );
    await allReceived;

    const closing = app.close();
    const responses = await Promise.all(inFlight);
    await closing;

    for (const response of responses) {
      expect(response.status).toBe(200);
      // The precise regression: a pool ended out from under a live request surfaces here as
      // `down` (the probe catches "Cannot use a pool after calling end" and grades it), not as
      // a thrown error the assertion above would have caught.
      expect(response.body.checks.database).toBe('up');
    }

    expect(order).toEqual(['listener-closed', 'pool-ended']);
  }, 30_000);
});
