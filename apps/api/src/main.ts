import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, resolveRequestBodyMaxBytes } from './common/configure-app';
import { loadRootEnv, envPort, envString } from './common/env';
import { captureServerError, flushSentry, initSentry } from './common/observability/sentry';
import { resolveTrustProxySetting } from './common/trust-proxy';

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
  // Lets OnModuleDestroy hooks (PrismaService, DueSoonWorker) run on SIGTERM/SIGINT
  // instead of the process being killed mid-connection.
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
