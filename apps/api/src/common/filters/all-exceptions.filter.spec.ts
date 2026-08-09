import { ArgumentsHost, HttpException, HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { IsInt, IsNotEmpty, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { validationExceptionFactory } from '../validation/validation-exception.factory';

interface CapturedResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function createHost(url = '/workspaces/w_1/tasks'): {
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
      getRequest: () => ({ url }),
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

      expect(logError).toHaveBeenCalledWith('database unreachable', error.stack);
    });
  });
});
