import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';

/**
 * Message overrides keyed by the HTTP status the `APIError` carries, for call sites where
 * one status deserves a more useful sentence than the generic fallback.
 */
export type BetterAuthStatusMessages = Readonly<Partial<Record<number, string>>>;

/**
 * `true` when `error` came out of an `auth.api.*` call as a Better Auth `APIError`.
 *
 * The `name` comparison mirrors Better Auth's own `isAPIError`: it keeps the narrowing
 * working even if a duplicated `better-call` copy ever breaks the `instanceof` identity.
 */
export function isBetterAuthApiError(error: unknown): error is APIError {
  return (
    error instanceof APIError ||
    (error instanceof Error && error.name === 'APIError' && 'statusCode' in error)
  );
}

/**
 * The Better Auth error code (`ORGANIZATION_ALREADY_EXISTS`, …), when the error carries one.
 *
 * Reading library-internal codes is deliberately confined to this module. A call site that
 * has to tell one library failure from another does it through this function, and the code
 * itself never reaches a client.
 */
export function betterAuthErrorCode(error: unknown): string | undefined {
  if (!isBetterAuthApiError(error)) {
    return undefined;
  }

  const code = error.body?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The Nest exception that preserves `statusCode`, or `undefined` when the status is not a
 * client error we are willing to speak for (5xx, and anything below 400).
 */
function toHttpException(statusCode: number, message: string): HttpException | undefined {
  switch (statusCode) {
    case 401:
      return new UnauthorizedException(message);
    case 403:
      return new ForbiddenException(message);
    case 404:
      return new NotFoundException(message);
    case 409:
      return new ConflictException(message);
    case 422:
      return new UnprocessableEntityException(message);
    default:
      return statusCode >= 400 && statusCode < 500 ? new BadRequestException(message) : undefined;
  }
}

/**
 * Re-throws a failure from an `auth.api.*` call in the shape `docs/api-conventions.md`
 * promises.
 *
 * Three cases, and the two that are *not* a mapping are the point of the helper:
 *
 * - A Better Auth `APIError` with a 4xx status becomes the Nest exception carrying that same
 *   status, with **our** `message`. Flattening every library failure into a `400` loses the
 *   real status, and forwarding the library's own string leaks internals — including, for
 *   invitations, whether an email already belongs to the workspace.
 * - A Better Auth `APIError` with any other status (5xx) is re-thrown untouched, so the
 *   global filter logs it and answers `500`. A library crash is not a client error.
 * - Anything else — including exceptions the caller threw inside its own `try` — is
 *   re-thrown untouched. Masking an unknown failure as a `400` hides real bugs behind a
 *   status that tells the client to stop retrying.
 *
 * @param message Fallback message, used for every mapped status without an override.
 * @param statusMessages Per-status overrides. Keep every one of them short, user-side, and
 *   generic wherever a specific one would confirm the existence of an account or a member.
 */
export function rethrowBetterAuthError(
  error: unknown,
  message: string,
  statusMessages?: BetterAuthStatusMessages,
): never {
  if (!isBetterAuthApiError(error)) {
    throw error;
  }

  const { statusCode } = error;
  const exception = toHttpException(statusCode, statusMessages?.[statusCode] ?? message);
  if (exception === undefined) {
    throw error;
  }

  throw exception;
}
