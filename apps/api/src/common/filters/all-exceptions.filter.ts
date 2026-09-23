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
import { PlanLimitCode, type PlanLimitDetail } from '@kurul/shared-types';
import type { ValidationDetail } from '../validation/validation-exception.factory';

interface ProblemDetails {
  statusCode: number;
  error: string;
  message: string;
  details?: ValidationDetail[];
  /** Present only on a plan-limit refusal (ADR 0032): which ceiling, and the two numbers. */
  planLimit?: PlanLimitDetail;
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

const PLAN_LIMIT_CODES = new Set<string>(Object.values(PlanLimitCode));

/**
 * Narrows the `planLimit` payload of a plan-limit refusal (ADR 0032).
 *
 * Validated rather than spread through, for `asValidationDetails`'s reason: the envelope is a
 * published contract, and a half-filled `planLimit` would be worse for a client than none at
 * all: it would branch on a ceiling nobody can name.
 */
function asPlanLimitDetail(value: unknown): PlanLimitDetail | undefined {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    !PLAN_LIMIT_CODES.has(value.code) ||
    typeof value.limit !== 'number' ||
    typeof value.current !== 'number'
  ) {
    return undefined;
  }

  return {
    code: value.code as PlanLimitDetail['code'],
    limit: value.limit,
    current: value.current,
  };
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

/**
 * The one sentence every oversized body gets, whichever ceiling it hit.
 *
 * Exported because the `/auth/*` mount writes its own 413 (`auth/mount-better-auth.ts`): Better
 * Auth sits below the Nest router, so no filter runs there, and a second spelling of the same
 * refusal would give `docs/self-hosting.md` two messages to tell apart where the envelope's
 * `path` already does that job.
 */
export const REQUEST_BODY_TOO_LARGE_MESSAGE = 'Request body is too large';

/**
 * Wording for a mapped `http-errors` client failure. Only `413` earns a sentence of its own —
 * it is the one an ordinary user can trigger by accident and the one they can act on. Every
 * other status falls back to its reason phrase rather than to copy invented for a case nobody
 * has measured.
 */
const HTTP_CLIENT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: REQUEST_BODY_TOO_LARGE_MESSAGE,
};

/**
 * Maps an [`http-errors`](https://github.com/jshttp/http-errors) **client** failure onto its own
 * status code (issue #214).
 *
 * `body-parser` — the JSON and urlencoded parsers `configure-app.ts` installs — signals every
 * rejection by throwing one of these. They are plain `Error` subclasses, not `HttpException`, so
 * before this branch existed an oversized body fell through to the `instanceof Error` fallback
 * and was answered `500` *and* filed in Sentry as an unexpected server fault. Both halves were
 * wrong: the client sent too much data, which is the definition of a 4xx.
 *
 * ## Why the test is this shape and not a wider one
 *
 * The four conditions below are exactly what `http-errors` itself uses in its published
 * `isHttpError()` helper: a real `Error`, a boolean `expose`, a numeric `statusCode`, and
 * `status === statusCode`. That is the library's own definition of "one of mine", reproduced
 * here rather than imported because `http-errors` is a transitive dependency of Express, not a
 * declared one of this package — depending on it directly to type-test an error would pin a
 * version this project does not otherwise own.
 *
 * The temptation is to accept anything carrying a numeric `status`. That would be a mistake with
 * a cost pointing the wrong way: HTTP client libraries (`got`, `undici`, AWS and S3 SDK clients,
 * `ioredis`' HTTP shims) all attach the *upstream's* status to a failure that is, from this
 * API's point of view, a server-side fault. Mapping those would answer the caller `404` for a
 * dependency that returned 404, and — because the filter's reporting rule keys on the resolved
 * `statusCode` — would drop the very failures Sentry exists to catch. The whole triple is what
 * separates "a library that speaks HTTP status codes as its error vocabulary" from "a library
 * that happened to record one".
 *
 * ## Why 4xx only
 *
 * `http-errors` produces 5xx instances too (`createError(503)`, `expose: false`). Those are
 * server faults and must keep the old path — a `500` envelope and a report. Capping the branch
 * at 4xx means no widening of it can ever silence a server error, which is the failure mode that
 * would be hardest to notice: nothing breaks, the alerts just stop.
 */
function mapHttpClientError(exception: unknown): { statusCode: number; message: string } | null {
  if (!(exception instanceof Error)) {
    return null;
  }

  const candidate = exception as unknown as Record<string, unknown>;
  const status = candidate.status;
  if (
    typeof candidate.expose !== 'boolean' ||
    typeof candidate.statusCode !== 'number' ||
    status !== candidate.statusCode
  ) {
    return null;
  }

  if (!Number.isInteger(status) || (status as number) < 400 || (status as number) > 499) {
    return null;
  }

  const statusCode = status as number;
  return {
    statusCode,
    // Never the library's own `message`. `PayloadTooLargeError` carries the configured `limit`
    // and the received `length`, and the wording is body-parser's rather than this project's;
    // the 5xx branches already refuse to echo an internal message in production, and this branch
    // holds to the same rule unconditionally because there is nothing here worth leaking either
    // way.
    message: HTTP_CLIENT_ERROR_MESSAGES[statusCode] ?? reasonPhrase(statusCode),
  };
}

/**
 * Every multer error code that refuses the request, and the status it is answered with. A closed
 * list: see `mapMulterError` for why a code missing from it keeps the `500` path.
 */
const MULTER_CLIENT_ERROR_STATUSES: ReadonlyMap<string, HttpStatus> = new Map([
  ['LIMIT_FILE_SIZE', HttpStatus.PAYLOAD_TOO_LARGE],
  ['LIMIT_PART_COUNT', HttpStatus.BAD_REQUEST],
  ['LIMIT_FILE_COUNT', HttpStatus.BAD_REQUEST],
  ['LIMIT_FIELD_KEY', HttpStatus.BAD_REQUEST],
  ['LIMIT_FIELD_VALUE', HttpStatus.BAD_REQUEST],
  ['LIMIT_FIELD_COUNT', HttpStatus.BAD_REQUEST],
  ['LIMIT_UNEXPECTED_FILE', HttpStatus.BAD_REQUEST],
  ['MISSING_FIELD_NAME', HttpStatus.BAD_REQUEST],
  ['LIMIT_FIELD_NESTING', HttpStatus.BAD_REQUEST],
  ['LIMIT_FIELD_ARRAY_INDEX', HttpStatus.BAD_REQUEST],
  ['INVALID_FIELD_NAME', HttpStatus.BAD_REQUEST],
]);

/**
 * Maps a multer refusal that `@nestjs/platform-express` passed on untranslated onto a client
 * status.
 *
 * `FileInterceptor` runs every multer failure through Nest's `transformException`
 * (`@nestjs/platform-express/multer/multer/multer.utils.js`), which turns the codes it knows into
 * a `BadRequestException`, or a `PayloadTooLargeException` for `LIMIT_FILE_SIZE`, and returns
 * anything else unchanged. Nest 11.2.1 knows the nine codes multer had up to 2.2.0; multer 2.3.0
 * added three (`lib/multer-error.js`). `LIMIT_FIELD_ARRAY_INDEX` is the refusal the
 * `fieldArrayIndexLimit: 0` in `attachment.module.ts` and `import.module.ts` exists to produce
 * (GHSA-535w-7cp7-47q4), and `INVALID_FIELD_NAME` is raised when append-field throws on a field
 * name. Both reached the `instanceof Error` fallback below as a plain `MulterError`: a `500` and a
 * Sentry report, for a request whose only fault was its field names.
 *
 * ## Every refusal code, keyed on `code`
 *
 * Nest 11.2.1 matches on `error.message`, and messages move: multer 2.4.0 rewords
 * `LIMIT_UNEXPECTED_FILE` from `Unexpected field` to `Unexpected file field`, which is how Nest
 * 12.0.3, pinning 2.4.0, answered a misnamed file part with a 500 (nestjs/nest#17769). From 2.4.0
 * on, multer's own JSDoc says to check `err.code` rather than the message. So the table holds all
 * eleven codes that refuse the request, not only the two Nest missed: the nine it translates first
 * cost nothing here, and the next rewording lands on this branch as a `400` instead of on the
 * fallback as a `500`. `LIMIT_FILE_SIZE` keeps the `413` Nest gives it, so the status of an
 * oversized file never depends on which layer caught it. The match never reads the message, so the
 * string collision ADR 0022 records for `transformException` (a storage error that happens to read
 * `File too large`) cannot happen here.
 *
 * ## `STREAM_DESTROYED` keeps the 500, and so does a code nobody has classified
 *
 * multer's disk storage raises `STREAM_DESTROYED` when the file stream is already gone by the time
 * it opens its output file: the upload's own plumbing failing, not a refusal of anything the client
 * sent. Nest's own fix for the other two (nestjs/nest#17857, in neither 11.2.6 nor 12.1.0) keeps
 * it a 500 for that reason, and the `memoryStorage()` this API uses never raises it. The list is
 * closed for the reason `mapHttpClientError` stops at 4xx: a code multer adds later reaches the
 * fallback and is reported, which is how this gap was found, instead of being answered `400` and
 * silenced before anyone has decided what it means.
 *
 * ## Matched by shape, not by `instanceof`
 *
 * `name === 'MulterError'` and a string `code` are what multer's constructor sets. The error comes
 * from the multer `@nestjs/platform-express` resolves, not the one `apps/api` declares: they are
 * one copy today only because the root `pnpm.overrides` entry lifts Nest's pin to the same 2.3.0,
 * and an `instanceof` against a second copy would fail silently and bring the 500 back. multer
 * also ships no types, `attachment/multer.d.ts` declares `memoryStorage` alone on purpose, and
 * importing the class at runtime would make the filter every failure passes through depend on an
 * upload library.
 *
 * ## The message is multer's, unlike `mapHttpClientError`'s
 *
 * multer's messages are fixed sentences looked up by code, with no configured limit or received
 * size in them, and they are what Nest already puts in this envelope for the codes it translates:
 * the sentence alone on the 413, the part name after ` - ` on a 400. The same two spellings here
 * give a client one message per refusal whichever layer caught it, and they are what
 * nestjs/nest#17857 produces for these codes. The part name is the client's own input, echoed
 * back as Nest echoes it for the codes it knows.
 */
function mapMulterError(exception: unknown): { statusCode: number; message: string } | null {
  if (!(exception instanceof Error) || exception.name !== 'MulterError') {
    return null;
  }

  const candidate = exception as unknown as Record<string, unknown>;
  const statusCode =
    typeof candidate.code === 'string'
      ? MULTER_CLIENT_ERROR_STATUSES.get(candidate.code)
      : undefined;
  if (statusCode === undefined) {
    return null;
  }

  const field = candidate.field;
  return {
    statusCode,
    message:
      statusCode === HttpStatus.BAD_REQUEST && typeof field === 'string' && field !== ''
        ? `${exception.message} - ${field}`
        : exception.message,
  };
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
   *   check, a `400` from `ValidationPipe`, a `429` from the throttler, a `413` from the body
   *   parser — these are the API working as designed, driven by whatever the client sent. They
   *   are already counted in the access log (`level: 'warn'`), and shipping them would bury the
   *   ~dozen real failures a month under thousands of events on a free-tier quota, which is how
   *   an alerting channel stops being read.
   * - **5xx and anything unrecognised does.** A `500` means the server broke: an unmapped
   *   Prisma error, a bug that threw, a `throw 'boom'` with no stack. Nobody sent that on
   *   purpose, and it is exactly the class of failure OPS-05 says currently goes unnoticed
   *   until a user complains.
   *
   * The split falls out of the control flow for free: this method is called only on
   * `statusCode >= 500` and on the branches that could not resolve a client status, so
   * reporting rides along with logging and the two can never drift apart. The
   * `mapHttpClientError` and `mapMulterError` branches are the two places where that had to be
   * arranged rather than inherited: both sit ahead of the `instanceof Error` fallback precisely so
   * a body parser's `413` (issue #214) or a multer refusal's `400` never reaches a call site here.
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
    let planLimit: PlanLimitDetail | undefined;

    const httpClientError = mapHttpClientError(exception);
    const multerError = mapMulterError(exception);

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
        planLimit = asPlanLimitDetail(body.planLimit);
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
    } else if (httpClientError !== null) {
      // Ahead of the `instanceof Error` fallback and behind everything else: an `http-errors`
      // instance *is* an `Error`, so the fallback would otherwise claim it first and answer 500.
      // No `reportFailure` here, and that is the point of the branch as much as the status code
      // is — see `mapHttpClientError`, and the signal/noise policy on `reportFailure`.
      statusCode = httpClientError.statusCode;
      error = reasonPhrase(statusCode);
      message = httpClientError.message;
    } else if (multerError !== null) {
      // Beside the branch above and for the same reason: a `MulterError` is an `Error`, so the
      // fallback would claim it and answer 500 with a report. See `mapMulterError`.
      statusCode = multerError.statusCode;
      error = reasonPhrase(statusCode);
      message = multerError.message;
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
      ...(planLimit ? { planLimit } : {}),
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
