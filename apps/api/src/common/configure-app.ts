import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mountBetterAuth } from '../auth/mount-better-auth';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { validationExceptionFactory } from './validation/validation-exception.factory';

/** Shared Nest bootstrap (HTTP app + e2e) so pipes/filters/CORS/auth stay in sync. */
export function configureApp(app: INestApplication, options: { corsOrigin: string }): void {
  app.enableCors({
    origin: options.corsOrigin,
    credentials: true,
  });

  mountBetterAuth(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
