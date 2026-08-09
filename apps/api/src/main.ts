import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadRootEnv, envPort, envString } from './common/env';

loadRootEnv();

async function bootstrap(): Promise<void> {
  // Read configuration before anything is constructed, so a bad value fails the process
  // instead of a half-started app holding an open database pool.
  const port = envPort('API_PORT', 4000);
  const webUrl = envString('WEB_URL', 'http://localhost:3000');

  const app = await NestFactory.create(AppModule);
  configureApp(app, { corsOrigin: webUrl });
  await app.listen(port);
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
