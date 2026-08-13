import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Prisma } from '../../generated/prisma';
import { isProductionEnv } from '../env';
import { getRequestId } from '../logging/request-id';
import { captureServerError, type ServerErrorContext } from '../observability/sentry';
import type { ValidationDetail } from '../validation/validation-exception.factory';

interface ProblemDetails {
  statusCode: number;
  error: string;
  message: string;
  details?: ValidationDetail[];
  path: string;
  timestamp: string;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The HTTP reason phrase for a status code (`404` → `Not Found`).
 *
 * `HttpStatus[404]` yields the enum *member name* (`NOT_FOUND`), which is not the value
 * `docs/api-conventions.md` specifies for `error`. Node's `STATUS_CODES` table is the
 * canonical source of the phrases themselves.
 */
function reasonPhrase(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? 'Error';
}

function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Narrows an already-structured `details` payload (produced by `validationExceptionFactory`). */
function asValidationDetails(value: unknown): ValidationDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const details: ValidationDetail[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.field !== 'string' || typeof item.message !== 'string') {
      return undefined;
    }
    details.push({
      field: item.field,
      message: item.message,
      ...(typeof item.constraint === 'string' ? { constraint: item.constraint } : {}),
    });
  }

  return details;
}

/**
 * Fallback for a `BadRequestException` carrying class-validator's default `string[]`
 * messages — i.e. one thrown without going through `validationExceptionFactory`. Those
 * messages always begin with the offending property name, so the field is recoverable even
 * though the constraint name is not.
 */
function detailsFromMessages(messages: readonly unknown[]): ValidationDetail[] {
  return messages.map((item) => {
    const message = describe(item);
    const [field] = message.split(' ');
    return { field: field !== undefined && field !== '' ? field : 'unknown', message };
  });
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  statusCode: number;
  message: string;
} | null {
  switch (error.code) {
    case 'P2002':
      return { statusCode: HttpStatus.CONFLICT, message: 'Resource already exists' };
    case 'P2025':
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Resource not found' };
    case 'P2003':
      return { statusCode: HttpStatus.CONFLICT, message: 'Related resource conflict' };
    default:
      return null;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Logs a failure with the correlation id appended, so the stack trace in the process log
   * and the access-log line for the same request join on `requestId` — and so does the
   * `requestId` the client was handed in the error envelope.
   *
   * The same four call sites are also the complete list of what reaches Sentry, and that is
   * not an accident of implementation — it is the filter's signal/noise policy:
   *
   * - **4xx never goes to Sentry.** A `404` for a deleted task, a `403` from a permission
   *   check, a `400` from `ValidationPipe`, a `429` from the throttler — these are the API
   *   working as designed, driven by whatever the client sent. They are already counted in
   *   the access log (`level: 'warn'`), and shipping them would bury the ~dozen real
   *   failures a month under thousands of events on a free-tier quota, which is how an
   *   alerting channel stops being read.
   * - **5xx and anything unrecognised does.** A `500` means the server broke: an unmapped
   *   Prisma error, a bug that threw, a `throw 'boom'` with no stack. Nobody sent that on
   *   purpose, and it is exactly the class of failure OPS-05 says currently goes unnoticed
   *   until a user complains.
   *
   * The split falls out of the control flow for free: `logFailure` was already called only
   * on `statusCode >= 500` and on the three non-`HttpException` branches, so reporting rides
   * along with logging and the two can never drift apart.
   */
  private reportFailure(
    error: unknown,
    context: ServerErrorContext,
    message: string,
    stack?: string,
  ): void {
    const line =
      context.requestId === undefined ? message : `${message} (requestId=${context.requestId})`;
    if (stack === undefined) {
      this.logger.error(line);
    } else {
      this.logger.error(line, stack);
    }

    // No-op unless `SENTRY_DSN` is set (see `common/observability/sentry.ts`), so this call
    // stays unconditional and the default install pays nothing for it.
    captureServerError(error, context);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId(request);
    // Built once and shared by every `reportFailure` branch below. `statusCode` is filled in
    // per branch because only the `HttpException` path knows a code other than 500.
    const failureContext: ServerErrorContext = {
      ...(requestId !== undefined ? { requestId } : {}),
      ...(typeof request.method === 'string' ? { method: request.method } : {}),
      ...(typeof request.url === 'string' ? { path: request.url } : {}),
    };

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = reasonPhrase(HttpStatus.INTERNAL_SERVER_ERROR);
    let message = 'An unexpected error occurred';
    let details: ValidationDetail[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      error = reasonPhrase(statusCode);
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (isRecord(body)) {
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (Array.isArray(body.message)) {
          message = 'Validation failed';
          details = detailsFromMessages(body.message);
        }
        if (typeof body.error === 'string') {
          error = body.error;
        }

        // A structured payload always wins over the message-string fallback.
        details = asValidationDetails(body.details) ?? details;
      }

      if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.reportFailure(
          exception,
          { ...failureContext, statusCode },
          exception.message,
          exception.stack,
        );
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      (isRecord(exception) && typeof exception.code === 'string' && 'clientVersion' in exception)
    ) {
      const prismaError = exception as Prisma.PrismaClientKnownRequestError;
      const mapped = mapPrismaError(prismaError);
      if (mapped) {
        statusCode = mapped.statusCode;
        error = reasonPhrase(statusCode);
        message = mapped.message;
      } else {
        this.reportFailure(
          prismaError,
          { ...failureContext, statusCode },
          prismaError.message,
          prismaError.stack,
        );
        if (!isProductionEnv()) {
          message = prismaError.message;
        }
      }
    } else if (exception instanceof Error) {
      this.reportFailure(
        exception,
        { ...failureContext, statusCode },
        exception.message,
        exception.stack,
      );
      if (!isProductionEnv()) {
        message = exception.message;
      }
    } else {
      // Nothing here has a stack, so the value itself is all there is to log — without
      // this branch a `throw 'boom'` becomes a completely silent 500.
      const described = describe(exception);
      // Wrapped in a real `Error` before it is reported: Sentry groups by exception type and
      // stack, and a bare string yields one undifferentiated "Error" issue with no frames.
      // The wrapper is created here (not inside `captureServerError`) so the stack starts at
      // the filter rather than inside the reporting helper.
      this.reportFailure(
        new Error(`Non-Error exception thrown: ${described}`),
        { ...failureContext, statusCode },
        `Non-Error exception thrown: ${described}`,
      );
      if (!isProductionEnv()) {
        message = described;
      }
    }

    const problem: ProblemDetails = {
      statusCode,
      error,
      message,
      ...(details ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
      // Present on every response the running app produces (`requestIdMiddleware` runs
      // ahead of the router), which is what makes a reported failure traceable: the same id
      // is in the `X-Request-Id` response header and in the server-side log line.
      ...(requestId !== undefined ? { requestId } : {}),
    };

    response.status(statusCode).json(problem);
  }
}
