import { ArgumentsHost, HttpException, HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { IsInt, IsNotEmpty, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { Prisma } from '../../generated/prisma';
import { initSentry, resetSentryForTesting } from '../observability/sentry';
import { validationExceptionFactory } from '../validation/validation-exception.factory';

interface CapturedResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const REQUEST_ID = '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d';

/** `null` means "the request carries no id at all" — i.e. `requestIdMiddleware` never ran. */
function createHost(
  url = '/workspaces/w_1/tasks',
  requestId: string | null = REQUEST_ID,
): {
  host: ArgumentsHost;
  response: CapturedResponse;
} {
  const response: CapturedResponse = {
    status: jest.fn(() => response),
    json: jest.fn(() => response),
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => (requestId === null ? { url } : { url, requestId }),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

function body(response: CapturedResponse): Record<string, unknown> {
  expect(response.json).toHaveBeenCalledTimes(1);
  const [firstCall] = response.json.mock.calls;
  return (firstCall?.[0] ?? {}) as Record<string, unknown>;
}

/**
 * Builds the exact shape `http-errors` produces, which is what `body-parser` throws.
 *
 * Hand-built rather than imported: `http-errors` is a transitive dependency of Express, not a
 * declared one of this package, and the filter deliberately matches on the *shape* rather than
 * on a constructor (see `mapHttpClientError`). Building the shape here therefore tests the same
 * contract the filter claims to honour. The end-to-end proof that a real `body-parser` error has
 * this shape is in `configure-app.spec.ts`, which sends an actual oversized body through an
 * actual Express stack.
 *
 * The three properties are the ones `http-errors`' own `isHttpError()` checks:
 * `expose: boolean`, `statusCode: number`, `status === statusCode`.
 */
function httpError(status: number, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    expose: status < 500,
    ...extra,
  });
}

class AssigneeDto {
  @IsNotEmpty()
  email!: string;
}

class CreateTaskDto {
  @IsNotEmpty()
  title!: string;

  @IsInt()
  @Min(0)
  estimatedMinutes!: number;

  @ValidateNested()
  @Type(() => AssigneeDto)
  assignee!: AssigneeDto;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('error field', () => {
    it('uses the HTTP reason phrase, not the HttpStatus enum name', () => {
      const { host, response } = createHost();

      // A bare HttpException carries no `error` in its payload, so the filter has to
      // derive it. `HttpStatus[404]` would give 'NOT_FOUND'.
      filter.catch(new HttpException('Task does not exist', HttpStatus.NOT_FOUND), host);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(body(response)).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Task does not exist',
        path: '/workspaces/w_1/tasks',
      });
    });

    it.each<[number, string]>([
      [HttpStatus.BAD_REQUEST, 'Bad Request'],
      [HttpStatus.UNAUTHORIZED, 'Unauthorized'],
      [HttpStatus.FORBIDDEN, 'Forbidden'],
      [HttpStatus.CONFLICT, 'Conflict'],
      [HttpStatus.UNPROCESSABLE_ENTITY, 'Unprocessable Entity'],
      [HttpStatus.TOO_MANY_REQUESTS, 'Too Many Requests'],
      [HttpStatus.INTERNAL_SERVER_ERROR, 'Internal Server Error'],
    ])('maps %i to "%s"', (status, phrase) => {
      const { host, response } = createHost();

      filter.catch(new HttpException('boom', status), host);

      expect(body(response).error).toBe(phrase);
    });
  });

  describe('validation details', () => {
    it('reports the real field name and constraint for each failure', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      });

      const thrown = await pipe
        .transform(
          { title: '', estimatedMinutes: -1, assignee: { email: '' } },
          { type: 'body', metatype: CreateTaskDto },
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      const { host, response } = createHost();
      filter.catch(thrown, host);

      const problem = body(response);
      expect(problem).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
      });

      const details = problem.details as Array<Record<string, unknown>>;
      expect(details).toContainEqual({
        field: 'title',
        constraint: 'isNotEmpty',
        message: 'title should not be empty',
      });
      expect(details).toContainEqual({
        field: 'estimatedMinutes',
        constraint: 'min',
        message: 'estimatedMinutes must not be less than 0',
      });
      // Nested DTOs keep their dotted path.
      expect(details).toContainEqual({
        field: 'assignee.email',
        constraint: 'isNotEmpty',
        message: 'email should not be empty',
      });
      expect(details).not.toContainEqual(
        expect.objectContaining({ field: 'unknown', constraint: 'validate' }),
      );
    });

    it('recovers the field name from class-validator default string messages', () => {
      const { host, response } = createHost();

      filter.catch(
        new HttpException(
          { statusCode: 400, message: ['title should not be empty'], error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );

      const problem = body(response);
      expect(problem.message).toBe('Validation failed');
      expect(problem.details).toEqual([{ field: 'title', message: 'title should not be empty' }]);
    });
  });

  /**
   * Issue #214. `body-parser` throws `http-errors` instances, which are plain `Error`
   * subclasses — not `HttpException` — so before this branch existed every one of them fell
   * through to the `instanceof Error` fallback and became a `500` that Sentry was told about.
   *
   * The tests below pin both halves of the branch: what it *does* convert, and — at least as
   * important — what it refuses to convert. A branch that mapped any `status`-bearing object
   * onto an HTTP status would turn an unrelated library's failure into a 4xx and hide a real
   * server fault from error tracking.
   */
  describe('http-errors client failures', () => {
    it('answers 413 for the PayloadTooLargeError body-parser throws', () => {
      const { host, response } = createHost();

      filter.catch(
        httpError(413, 'request entity too large', {
          type: 'entity.too.large',
          length: 4_194_304,
          limit: 1_048_576,
        }),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(413);
      expect(body(response)).toMatchObject({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Request body is too large',
        path: '/workspaces/w_1/tasks',
        requestId: REQUEST_ID,
      });
    });

    // 413 is the one status with copy of its own; every other client status falls back to its
    // reason phrase rather than to invented wording for a case nobody has measured. These are
    // the other shapes `body-parser` can throw at the filter.
    it.each<[number, string, string]>([
      [400, 'request aborted', 'Bad Request'],
      [415, 'unsupported content encoding "br"', 'Unsupported Media Type'],
    ])('carries a %i through with its reason phrase', (status, message, phrase) => {
      const { host, response } = createHost();

      filter.catch(httpError(status, message), host);

      expect(response.status).toHaveBeenCalledWith(status);
      expect(body(response)).toMatchObject({ statusCode: status, error: phrase, message: phrase });
    });

    // The message is a fixed string chosen here, never the library's own: `PayloadTooLargeError`
    // carries the configured `limit` and the received `length` on the error, and its `message`
    // is wording this project did not write. The rule has to hold in development too, because
    // the substitution is not conditional on the environment.
    it.each<[string, string | undefined]>([
      ['development', undefined],
      ['production', 'production'],
    ])('never echoes the library message back to the client (%s)', (_label, nodeEnv) => {
      const previous = process.env.NODE_ENV;
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;

      try {
        const { host, response } = createHost();

        filter.catch(
          httpError(413, 'request entity too large', {
            type: 'entity.too.large',
            length: 4_194_304,
            limit: 1_048_576,
          }),
          host,
        );

        const serialised = JSON.stringify(body(response));
        expect(serialised).not.toContain('request entity too large');
        expect(serialised).not.toContain('entity.too.large');
        expect(serialised).not.toContain('1048576');
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    });

    /**
     * Not this branch's job, and the test says so out loud.
     *
     * A malformed JSON body reaches the filter as a `BadRequestException`, because Nest's own
     * `RoutesResolver.mapExternalException` converts any `SyntaxError` before the filter is
     * called. It was therefore never part of #214 — it was already a 4xx and already unreported
     * — and the branch added for #214 deliberately does not try to take it over.
     */
    it('leaves a parse failure to the HttpException branch Nest already routes it through', () => {
      const { host, response } = createHost();

      filter.catch(new HttpException('Unexpected end of JSON input', HttpStatus.BAD_REQUEST), host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(body(response)).toMatchObject({
        statusCode: 400,
        message: 'Unexpected end of JSON input',
      });
    });

    it('leaves a 5xx http-error as a 500 the server owns', () => {
      // The branch is deliberately capped at 4xx. An `http-errors` 5xx is still a server
      // failure and must keep the old path: a 500 envelope *and* a report. Widening the branch
      // to every `status` would silently stop reporting them.
      const { host, response } = createHost();
      const error = httpError(503, 'upstream gone');

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(body(response)).toMatchObject({ statusCode: 500, error: 'Internal Server Error' });
      expect(logError).toHaveBeenCalledWith(`upstream gone (requestId=${REQUEST_ID})`, error.stack);
    });

    it('ignores an error that merely carries a numeric status', () => {
      // `node-fetch`, `got`, AWS SDK clients and others all attach a `status`/`statusCode` to
      // failures that are, from this API's point of view, server-side faults. Only the full
      // `http-errors` shape counts.
      const { host, response } = createHost();
      const error = Object.assign(new Error('upstream responded 404'), { status: 404 });

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(logError).toHaveBeenCalledWith(
        `upstream responded 404 (requestId=${REQUEST_ID})`,
        error.stack,
      );
    });

    it('ignores a status pair without the boolean `expose` flag', () => {
      const { host, response } = createHost();
      const error = Object.assign(new Error('upstream responded 404'), {
        status: 404,
        statusCode: 404,
      });

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(500);
    });

    it('ignores a plain object — a stack is what makes it an error worth mapping', () => {
      const { host, response } = createHost();

      filter.catch({ status: 413, statusCode: 413, expose: true }, host);

      expect(response.status).toHaveBeenCalledWith(500);
    });
  });

  describe('non-Error throws', () => {
    it('logs a thrown string before responding 500', () => {
      const { host, response } = createHost();

      filter.catch('boom', host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(body(response)).toMatchObject({
        statusCode: 500,
        error: 'Internal Server Error',
      });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('maps Prisma unique violations to 409', () => {
      const { host, response } = createHost();
      const error = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        clientVersion: '7.0.0',
        name: 'PrismaClientKnownRequestError',
      });

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(409);
      expect(body(response)).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        message: 'Resource already exists',
      });
    });

    it('maps Prisma not-found to 404', () => {
      const { host, response } = createHost();
      const error = Object.assign(new Error('Record to update not found'), {
        code: 'P2025',
        clientVersion: '7.0.0',
        name: 'PrismaClientKnownRequestError',
      });

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(body(response)).toMatchObject({
        statusCode: 404,
        message: 'Resource not found',
      });
    });

    // ADR 0016: a foreign-key violation is a 409, not the 422 an audit pass proposed. Both
    // shapes P2003 takes in this schema are conflicts with database *state* rather than
    // faults in the request body — see the ADR for the full argument. The two tests below
    // pin one shape each so the mapping cannot drift back on a reviewer's say-so.
    it('maps a blocked delete (P2003 on a Restrict relation) to 409', () => {
      const { host, response } = createHost('/workspaces/w_1/members/u_1');
      const error = Object.assign(
        new Error('Foreign key constraint violated on the constraint: `Task_createdById_fkey`'),
        {
          code: 'P2003',
          clientVersion: '7.0.0',
          name: 'PrismaClientKnownRequestError',
          meta: { field_name: 'Task_createdById_fkey (index)' },
        },
      );

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(409);
      expect(body(response)).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        message: 'Related resource conflict',
      });
    });

    it('does not leak the database constraint name into a P2003 response', () => {
      // `Task_createdById_fkey` is schema naming; clients branch on `statusCode` and
      // `error`, and 409 carries no `details` array to put a field name in anyway.
      const { host, response } = createHost();
      const error = Object.assign(
        new Error('Foreign key constraint violated on the constraint: `Task_columnId_fkey`'),
        {
          code: 'P2003',
          clientVersion: '7.0.0',
          name: 'PrismaClientKnownRequestError',
          meta: { field_name: 'Task_columnId_fkey (index)' },
        },
      );

      filter.catch(error, host);

      const problem = body(response);
      expect(problem.message).toBe('Related resource conflict');
      expect(problem.details).toBeUndefined();
      expect(JSON.stringify(problem)).not.toContain('fkey');
    });

    it('logs a thrown plain object before responding 500', () => {
      const { host, response } = createHost();

      filter.catch({ unexpected: true }, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('unexpected'));
    });

    it('logs thrown Errors with their stack', () => {
      const { host } = createHost();
      const error = new Error('database unreachable');

      filter.catch(error, host);

      expect(logError).toHaveBeenCalledWith(
        `database unreachable (requestId=${REQUEST_ID})`,
        error.stack,
      );
    });
  });

  // BE-03: a 500 is only actionable if the line in the process log and the response the user
  // is looking at can be joined. Both carry the id `requestIdMiddleware` put on the request.
  describe('correlation', () => {
    it('returns the request id in the error envelope', () => {
      const { host, response } = createHost();

      filter.catch(new HttpException('Task does not exist', HttpStatus.NOT_FOUND), host);

      expect(body(response)).toMatchObject({ statusCode: 404, requestId: REQUEST_ID });
    });

    it('appends the request id to the 5xx log line', () => {
      const { host, response } = createHost();
      const error = new HttpException('upstream exploded', HttpStatus.BAD_GATEWAY);

      filter.catch(error, host);

      expect(logError).toHaveBeenCalledWith(
        `upstream exploded (requestId=${REQUEST_ID})`,
        error.stack,
      );
      expect(body(response).requestId).toBe(REQUEST_ID);
    });

    it('correlates non-Error throws too', () => {
      const { host, response } = createHost();

      filter.catch('boom', host);

      expect(logError).toHaveBeenCalledWith(
        `Non-Error exception thrown: boom (requestId=${REQUEST_ID})`,
      );
      expect(body(response).requestId).toBe(REQUEST_ID);
    });

    it('does not log a 4xx, but still hands the client an id to quote', () => {
      const { host, response } = createHost();

      filter.catch(new HttpException('Nope', HttpStatus.FORBIDDEN), host);

      expect(logError).not.toHaveBeenCalled();
      expect(body(response).requestId).toBe(REQUEST_ID);
    });

    it('omits requestId rather than emitting null when no id is on the request', () => {
      const { host, response } = createHost('/workspaces/w_1/tasks', null);

      filter.catch(new Error('database unreachable'), host);

      const problem = body(response);
      expect('requestId' in problem).toBe(false);
      expect(logError).toHaveBeenCalledWith('database unreachable', expect.any(String));
    });

    it('ignores a client-forged id that never passed the middleware', () => {
      // getRequestId re-validates: nothing unsafe reaches a log line or a response body.
      const { host, response } = createHost('/workspaces/w_1/tasks', 'forged\r\nX-Admin: 1');

      filter.catch(new HttpException('Nope', HttpStatus.FORBIDDEN), host);

      const problem = body(response);
      expect('requestId' in problem).toBe(false);
    });
  });

  /**
   * The signal/noise policy documented on `reportFailure`. These assertions are the reason a
   * self-hoster's Sentry quota stays readable: without them, a refactor that moved the
   * capture one level up (to the top of `catch`) would ship every `404` and `403` and nobody
   * would notice until the free tier ran out.
   */
  describe('error tracking', () => {
    beforeEach(() => {
      resetSentryForTesting();
    });

    afterEach(() => {
      resetSentryForTesting();
    });

    /** Installs a fake SDK through the loader seam and returns its `captureException` spy. */
    async function enableFakeSentry(): Promise<{
      captureException: jest.Mock;
      scope: { setTag: jest.Mock; setContext: jest.Mock };
    }> {
      const scope = { setTag: jest.fn(), setContext: jest.fn() };
      const captureException = jest.fn();
      const api = {
        init: jest.fn(),
        captureException,
        close: jest.fn(() => Promise.resolve(true)),
        withScope: (callback: (s: typeof scope) => void) => {
          callback(scope);
        },
      } as unknown as typeof import('@sentry/node');

      process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
      try {
        await initSentry(() => Promise.resolve(api));
      } finally {
        delete process.env.SENTRY_DSN;
      }

      return { captureException, scope };
    }

    it.each<[string, number]>([
      ['400', HttpStatus.BAD_REQUEST],
      ['401', HttpStatus.UNAUTHORIZED],
      ['403', HttpStatus.FORBIDDEN],
      ['404', HttpStatus.NOT_FOUND],
      ['409', HttpStatus.CONFLICT],
      ['429', HttpStatus.TOO_MANY_REQUESTS],
    ])('does not report a %s — client errors are noise, not signal', async (_label, status) => {
      const { captureException } = await enableFakeSentry();
      const { host } = createHost();

      filter.catch(new HttpException('nope', status), host);

      expect(captureException).not.toHaveBeenCalled();
    });

    it('reports a 500 HttpException with the request id attached', async () => {
      const { captureException, scope } = await enableFakeSentry();
      const { host } = createHost();
      const exception = new HttpException('upstream broke', HttpStatus.INTERNAL_SERVER_ERROR);

      filter.catch(exception, host);

      expect(captureException).toHaveBeenCalledWith(exception);
      expect(scope.setTag).toHaveBeenCalledWith('requestId', REQUEST_ID);
      expect(scope.setTag).toHaveBeenCalledWith('http.status_code', '500');
    });

    it('reports an unmapped Prisma error but not one that maps onto a 4xx', async () => {
      const { captureException } = await enableFakeSentry();

      filter.catch(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
        }),
        createHost().host,
      );
      expect(captureException).not.toHaveBeenCalled();

      filter.catch(
        new Prisma.PrismaClientKnownRequestError('Transaction failed', {
          code: 'P2034',
          clientVersion: '7.0.0',
        }),
        createHost().host,
      );
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    // Issue #214's second half: the wrong status code was only half the defect. Every oversized
    // body was also an event on a self-hoster's Sentry quota, filed as a server fault.
    it('does not report an oversized body — a 413 is the client’s doing', async () => {
      const { captureException } = await enableFakeSentry();

      filter.catch(
        httpError(413, 'request entity too large', { type: 'entity.too.large' }),
        createHost().host,
      );

      expect(captureException).not.toHaveBeenCalled();
      // `reportFailure` logs and captures together, on purpose, so the absent log line is a
      // second, independent witness that the reporting call site was never reached.
      expect(logError).not.toHaveBeenCalled();
    });

    it('still reports an http-errors 5xx', async () => {
      // The control for the assertion above: "4xx is not reported" is only evidence if the
      // same branchless shape *is* reported when it means the server broke.
      const { captureException } = await enableFakeSentry();
      const error = httpError(503, 'upstream gone');

      filter.catch(error, createHost().host);

      expect(captureException).toHaveBeenCalledWith(error);
    });

    it('reports a plain Error', async () => {
      const { captureException } = await enableFakeSentry();
      const error = new Error('database unreachable');

      filter.catch(error, createHost().host);

      expect(captureException).toHaveBeenCalledWith(error);
    });

    it('wraps a non-Error throw so Sentry has something to group by', async () => {
      const { captureException } = await enableFakeSentry();

      filter.catch('boom', createHost().host);

      const [reported] = captureException.mock.calls[0] as [unknown];
      expect(reported).toBeInstanceOf(Error);
      expect((reported as Error).message).toBe('Non-Error exception thrown: boom');
    });

    it('still logs everything it always logged when error tracking is off', () => {
      // The default install: no DSN, so `captureServerError` no-ops and the log line — the
      // only observability a self-hoster gets out of the box — must be unchanged.
      filter.catch(new Error('database unreachable'), createHost().host);

      expect(logError).toHaveBeenCalledWith(
        `database unreachable (requestId=${REQUEST_ID})`,
        expect.any(String),
      );
    });
  });
});
