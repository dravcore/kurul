import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { resolveTrustProxySetting } from '../../src/common/trust-proxy';

export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app, {
    corsOrigin: process.env.WEB_URL ?? 'http://localhost:3000',
    // Off by default, same as production — every integration spec's request is a direct
    // loopback connection from supertest, so there is no proxy hop to trust. A spec that wants
    // to exercise the reverse-proxy path builds its own app with `configureApp` directly (see
    // `src/common/trust-proxy.spec.ts`) rather than overriding process-wide state here.
    trustProxy: resolveTrustProxySetting(process.env.TRUST_PROXY ?? 'false'),
  });
  await app.init();

  // Bind the HTTP server once, for the lifetime of the suite.
  //
  // supertest only takes over the server lifecycle when it finds the server unbound:
  // `new Test(...)` calls `server.listen(0)` whenever `server.address()` is null, and
  // `Test#end` closes that server again as soon as the response lands. An app that was only
  // `init()`ed is never bound, so *every request in the suite* re-bound the one shared Nest
  // server on a fresh ephemeral port and tore it down again — hundreds of bind/teardown
  // cycles per file. That churn is what made the suite flaky: a connection accepted against
  // a listener already on its way out gets reset, which reaches the test as `socket hang up`,
  // `read ECONNRESET`, or `Parse Error: Expected HTTP/, RTSP/ or ICE/` on whichever request
  // happened to lose the race.
  //
  // Binding here keeps `address()` non-null, so supertest reuses this one listener for every
  // request and never calls `close()` itself; `app.close()` stays the single owner of
  // shutdown. Loopback-only, to match the `127.0.0.1` origin supertest requests against.
  await app.listen(0, '127.0.0.1');

  return app;
}
