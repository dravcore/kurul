import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory, type ValidationDetail } from './validation-exception.factory';

/**
 * Runs a DTO through the exact `ValidationPipe` configuration `common/configure-app.ts` wires
 * onto every route (`whitelist`, `forbidNonWhitelisted`, `transform`, and this project's own
 * `exceptionFactory`), so a DTO spec exercises the same rejection shape a client actually
 * receives rather than raw `class-validator` output. Shared by every `*.dto.spec.ts` so each one
 * only has to state the body and the expectation, not rebuild the pipe.
 */

type Metatype = new () => object;

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

export function transformDto(metatype: Metatype, body: Record<string, unknown>): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype });
}

/** Runs the pipe and returns the accepted DTO, failing the test if it was rejected. */
export async function acceptedDto<T>(
  metatype: Metatype,
  body: Record<string, unknown>,
): Promise<T> {
  return (await transformDto(metatype, body)) as T;
}

/** Runs the pipe and returns the 400 payload, failing the test if the body was accepted. */
export async function rejectedDto(
  metatype: Metatype,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; details: ValidationDetail[] }> {
  const outcome = await transformDto(metatype, body).then(
    () => undefined,
    (error: unknown) => error,
  );

  if (outcome === undefined) {
    throw new Error(`Expected ${metatype.name} to reject ${JSON.stringify(body)}`);
  }

  const exception = outcome as { getStatus: () => number; getResponse: () => unknown };
  const response = exception.getResponse() as { details?: ValidationDetail[] };
  return { statusCode: exception.getStatus(), details: response.details ?? [] };
}

export function dtoFields(details: ValidationDetail[]): string[] {
  return details.map((detail) => detail.field);
}
