import { ArgumentsHost, HttpException, HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { IsInt, IsNotEmpty, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AllExceptionsFilter } from './all-exceptions.filter';
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
});
