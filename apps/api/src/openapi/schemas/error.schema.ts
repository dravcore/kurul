import type { ValidationDetail } from '../../common/validation/validation-exception.factory';

/**
 * Every schema in this directory is a **class that `implements` the interface it describes**.
 *
 * `@nestjs/swagger` builds schemas from classes, and every response type in this API is a bare
 * TypeScript interface in `@kurul/shared-types` — erased at compile time, so it produces no
 * schema at all. Mirroring one by hand normally means creating a second source of truth that
 * drifts on the first field nobody remembers to copy. `implements` is what stops that: a field
 * added to the interface, removed from it, or retyped makes this file fail `pnpm typecheck`,
 * which is the same technique `configure-app.ts` uses to narrow `useBodyParser`.
 *
 * The property bodies are otherwise empty on purpose. The Swagger CLI plugin
 * (`nest-cli.json`) reads the declared TypeScript type and the doc comment, so `@ApiProperty`
 * is only written where the plugin cannot know something — a format, an example, a pattern.
 */

/** One field-level validation problem, as `ValidationPipe` reports it. */
export class ValidationDetailSchema implements ValidationDetail {
  /** Property path that failed, as sent — `title`, `assignees.0.userId`. */
  field!: string;

  /**
   * The class-validator rule that rejected it (`isNotEmpty`, `min`, `isUuid`).
   *
   * Absent when the failure came from an exception thrown without going through
   * `validationExceptionFactory`, where only the message survives.
   */
  constraint?: string;

  /** Human-readable sentence for this one field. */
  message!: string;
}

/**
 * The single error shape this API answers with — every status, every route, including failures
 * nobody wrote a handler for.
 *
 * Produced by one global filter (`AllExceptionsFilter`). There is no second error format, and
 * clients branch on `statusCode` and `error`, never on `message` text.
 *
 * The one documented exception is `GET /health/ready`, which answers `503` with its probe
 * document rather than this envelope: its caller is a healthcheck, not a client.
 */
export class ErrorEnvelopeSchema {
  /** Mirrors the HTTP status of the response. */
  statusCode!: number;

  /**
   * Stable reason phrase for the status — `Bad Request`, `Not Found`, `Payload Too Large`.
   *
   * Node's own `http.STATUS_CODES` table, not the `HttpStatus` enum member name, so it is the
   * phrase a client can match on rather than `NOT_FOUND`.
   */
  error!: string;

  /**
   * One human-readable sentence, safe to log.
   *
   * Never a raw exception string under `NODE_ENV=production`, and never a stack trace anywhere.
   */
  message!: string;

  /** Per-field problems. Present on validation failures (`400`, `422`) and nowhere else. */
  details?: ValidationDetailSchema[];

  /** The request path that failed, query string included. */
  path!: string;

  /** ISO 8601 UTC instant the envelope was written. */
  timestamp!: string;

  /**
   * Correlation id — the same value as the `X-Request-Id` response header and as the server's
   * log lines for this request. A user reporting a failure quotes one id and it selects exactly
   * one request.
   */
  requestId?: string;
}
