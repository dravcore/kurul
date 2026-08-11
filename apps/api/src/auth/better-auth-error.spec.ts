import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';
import {
  betterAuthErrorCode,
  isBetterAuthApiError,
  rethrowBetterAuthError,
} from './better-auth-error';

/** Runs the helper and returns whatever came out, so assertions can inspect it. */
function capture(error: unknown, message = 'Something went wrong'): unknown {
  try {
    rethrowBetterAuthError(error, message);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('rethrowBetterAuthError returned instead of throwing');
}

describe('isBetterAuthApiError', () => {
  it('recognises an APIError', () => {
    expect(isBetterAuthApiError(new APIError('NOT_FOUND', { message: 'nope' }))).toBe(true);
  });

  it('recognises a structurally identical error from a duplicated better-call copy', () => {
    const lookalike = Object.assign(new Error('nope'), { name: 'APIError', statusCode: 404 });

    expect(isBetterAuthApiError(lookalike)).toBe(true);
  });

  it('rejects ordinary errors and non-errors', () => {
    expect(isBetterAuthApiError(new Error('boom'))).toBe(false);
    expect(isBetterAuthApiError(new NotFoundException('nope'))).toBe(false);
    expect(isBetterAuthApiError('boom')).toBe(false);
    expect(isBetterAuthApiError(undefined)).toBe(false);
  });
});

describe('betterAuthErrorCode', () => {
  it('reads the code Better Auth attaches to the body', () => {
    // Shape produced by `APIError.from(status, ORGANIZATION_ERROR_CODES.*)`, which is how
    // the organization plugin raises this since better-auth 1.6. Earlier versions derived
    // `code` from the message inside the constructor; now it is carried explicitly.
    const error = new APIError('BAD_REQUEST', {
      message: 'Organization already exists',
      code: 'ORGANIZATION_ALREADY_EXISTS',
    });

    expect(betterAuthErrorCode(error)).toBe('ORGANIZATION_ALREADY_EXISTS');
  });

  it('returns undefined when the body carries only a message', () => {
    expect(
      betterAuthErrorCode(new APIError('BAD_REQUEST', { message: 'Organization already exists' })),
    ).toBeUndefined();
  });

  it('returns undefined for an APIError without a body and for anything else', () => {
    expect(betterAuthErrorCode(new APIError('BAD_REQUEST'))).toBeUndefined();
    expect(betterAuthErrorCode(new Error('Organization already exists'))).toBeUndefined();
  });
});

describe('rethrowBetterAuthError', () => {
  it.each([
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [404, NotFoundException],
    [409, ConflictException],
    [422, UnprocessableEntityException],
  ])('maps %s to the Nest exception carrying that status', (status, expected) => {
    const thrown = capture(new APIError(status as 401, { message: 'library internals' }));

    expect(thrown).toBeInstanceOf(expected);
    expect((thrown as HttpException).getStatus()).toBe(status);
  });

  it.each([400, 402, 429])('flattens other 4xx (%s) to 400', (status) => {
    const thrown = capture(new APIError(status as 400, { message: 'library internals' }));

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as HttpException).getStatus()).toBe(400);
  });

  it('replaces the library message with ours', () => {
    const thrown = capture(
      new APIError('BAD_REQUEST', { message: 'User is already a member of this organization' }),
      'Failed to create invitation',
    );

    expect((thrown as HttpException).message).toBe('Failed to create invitation');
    expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('member');
  });

  it('prefers a per-status message over the fallback', () => {
    let thrown: unknown;
    try {
      rethrowBetterAuthError(new APIError('FORBIDDEN', { message: 'internal' }), 'Fallback', {
        403: 'You are not allowed to send this invitation',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as HttpException).message).toBe('You are not allowed to send this invitation');
  });

  it('falls back when no override matches the status', () => {
    let thrown: unknown;
    try {
      rethrowBetterAuthError(new APIError('NOT_FOUND', { message: 'internal' }), 'Fallback', {
        403: 'Not this one',
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as HttpException).message).toBe('Fallback');
  });

  it('re-throws a 5xx APIError untouched so the global filter logs it and answers 500', () => {
    const error = new APIError('INTERNAL_SERVER_ERROR', { message: 'adapter exploded' });

    expect(capture(error)).toBe(error);
  });

  it('re-throws a non-APIError untouched rather than masking it as a 400', () => {
    const error = new Error('prisma connection lost');

    expect(capture(error)).toBe(error);
  });

  it('re-throws exceptions the caller already threw inside its own try block', () => {
    const error = new NotFoundException('Workspace not found');

    expect(capture(error)).toBe(error);
  });

  it('re-throws non-Error values untouched', () => {
    expect(capture('boom')).toBe('boom');
  });
});
