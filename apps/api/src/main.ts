import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, resolveRequestBodyMaxBytes } from './common/configure-app';
import { loadRootEnv, envPort, envString } from './common/env';
import { captureServerError, flushSentry, initSentry } from './common/observability/sentry';
import { resolveTrustProxySetting } from './common/trust-proxy';
import { serveOpenApi } from './openapi/serve-openapi';

loadRootEnv();

async function bootstrap(): Promise<void> {
  // Read configuration before anything is constructed, so a bad value fails the process
  // instead of a half-started app holding an open database pool.
  const port = envPort('API_PORT', 4000);
  const webUrl = envString('WEB_URL', 'http://localhost:3000');
  // Off by default — see `resolveTrustProxySetting` for what each shape means and why a
  // directly-exposed instance must never trust an inbound X-Forwarded-For by default.
  const trustProxy = resolveTrustProxySetting(envString('TRUST_PROXY', 'false'));
  // 1 MiB unless `REQUEST_BODY_MAX_BYTES` says otherwise. Read here, with the others, so a bad
  // value stops the process instead of turning every write into an unexplainable 413.
  const bodyLimitBytes = resolveRequestBodyMaxBytes();

  // Awaited before the container is built so no request can be served by a Nest app whose
  // exception filter would silently drop the first failures. Returns immediately without
  // loading the SDK when `SENTRY_DSN` is unset, which is the default — see
  // `common/observability/sentry.ts`.
  await initSentry();

  const app = await NestFactory.create(AppModule);
  configureApp(app, { corsOrigin: webUrl, trustProxy, bodyLimitBytes });
  // After `configureApp` and not inside it: `configureApp` is shared with the e2e harness, and
  // scanning the whole container for an OpenAPI document in every integration test would be
  // paid for on every run. Off under NODE_ENV=production unless API_DOCS_ENABLED says otherwise
  // — the reasoning is on `openApiDocsEnabled`.
  serveOpenApi(app);
  // Runs Nest's close sequence on SIGTERM/SIGINT instead of the process dying mid-connection.
  //
  // That sequence has a boundary in the middle of it, and it is the whole reason this API
  // splits its teardown across two hooks (@nestjs/core `NestApplicationContext.close` and
  // `NestApplication.dispose`, verified against 11.2.1):
  //
  //   onModuleDestroy -> beforeApplicationShutdown -> Socket.io and the HTTP listener close
  //   -> onApplicationShutdown
  //
  // So the rule for this codebase is: anything a live request or an open socket still needs -
  // the shared pg pool, the Redis clients, the mail transport, the storage backend, the BullMQ
  // workers - is released in `onApplicationShutdown`, never in `onModuleDestroy`, because a
  // destroy hook runs while the listener is still accepting and serving. The classes that do it
  // are deliberately not enumerated here: `grep -rn onApplicationShutdown apps/api/src` is the
  // current list, and a list written down in a comment is one that goes stale.
  //
  // Within a phase Nest orders modules by their distance from the root, and every global module
  // is given `Number.MAX_VALUE` for that distance (@nestjs/core `injector/container.js`), so a
  // global module's hooks run first on startup and last on shutdown. That is the rule the
  // bounded worker close in `common/close-worker.ts` relies on: a global module holding the
  // shared pg pool is torn down after the non-global modules that own the workers.
  app.enableShutdownHooks();
  await app.listen(port);
}

void bootstrap().catch(async (error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  // A boot failure is the one error nobody is around to notice from a log — the process is
  // about to disappear, and `AllExceptionsFilter` never got the chance to exist. Captured
  // explicitly (the SDK's own global handlers do not fire: this rejection *is* handled, by
  // this very callback) and then flushed, because `process.exit` below would otherwise drop
  // the event while it is still queued in the transport. Both calls are no-ops when error
  // tracking is off.
  captureServerError(error, { path: 'bootstrap' });
  await flushSentry();
  process.exit(1);
});
