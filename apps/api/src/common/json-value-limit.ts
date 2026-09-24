import { PayloadTooLargeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_BODY_TOO_LARGE_MESSAGE } from './filters/all-exceptions.filter';

/**
 * The most values a JSON request body may hold: every member of every object and every element of
 * every array in it, at any depth, the body itself aside.
 *
 * `REQUEST_BODY_MAX_BYTES` bounds a body's size and nothing bounded its shape, and the global
 * `ValidationPipe` pays for the shape, not the size. It hands every body to class-transformer's
 * `plainToInstance` before class-validator sees it, and class-transformer 0.5.1 de-duplicates an
 * object's keys with `keys.filter((key, index, self) => self.indexOf(key) === index)`
 * (`TransformOperationExecutor.getKeys`), which is quadratic in the keys of one object. Measured
 * through the stack `configureApp` installs, with keys the DTO does not declare:
 *
 * - `plainToInstance` alone took 70 ms on 10,000 keys, 204 on 20,000, 743 on 40,000 and 2,830 on
 *   80,000, against 40 ms for class-validator on the same 80,000;
 * - an 868,891-byte body of 80,000 short keys took 3 seconds to refuse, and a timer due 10 ms
 *   after it went out fired after 3,011: the process did nothing else in between. A body of the
 *   same size with one key took 10 ms;
 * - 131,071 three-character keys, as many as the 1 MiB default admits, took 8 seconds.
 *
 * Every route with a body DTO is behind `SessionAuthGuard`, so the sender needs a session or a
 * token, which open sign-up hands to anyone, and `DEFAULT_RATE_LIMIT` lets one address send 100
 * such requests a minute to each of those routes. Two shapes cost a `500` instead, logged and
 * reported as a server fault: a value nested 10,000 deep, 20,021 bytes, overflows the recursion in
 * Nest's `ValidationPipe.stripProtoKeys`, which runs before class-transformer, and 349,511 empty
 * `dispositions` sent to `DeleteAccountDto`, 1 MiB, overflowed the stack in
 * `validationExceptionFactory` 3.3 seconds in.
 *
 * ## Why 1,000
 *
 * It is the number the other body parser already enforces. `configure-app.ts` installs the
 * urlencoded parser with body-parser's default `parameterLimit` of 1,000, and a form body with
 * 1,001 fields has always been refused with the `413` this answers with (measured). The JSON parser
 * has no such option, which is how its bodies came to have no limit on their shape at all.
 *
 * It is also above everything a DTO takes. The largest body any DTO accepts is `DeleteAccountDto`'s
 * with all 200 `dispositions` it allows, each with its three members: 802 values. Every other body
 * DTO declares at most seven. At the ceiling the costs above are gone: a thousand keys in one
 * object take class-transformer about 4 ms, and a thousand levels of nesting, the deepest a
 * thousand values can make, are refused by validation as they always were.
 *
 * ## Refused like an oversized body
 *
 * A `413` in the error envelope, with the sentence every oversized body gets, and not reported:
 * the urlencoded parser's own refusal of a form body over its parameter limit reads the same, so a
 * body refused for its shape reads the same whichever parser read it. It is thrown as Nest's
 * `PayloadTooLargeException` rather than written here, so `AllExceptionsFilter` writes the envelope
 * as it writes every other.
 */
export const MAX_JSON_BODY_VALUES = 1000;

/**
 * True once `body` holds more than `limit` values, counted as {@link MAX_JSON_BODY_VALUES} counts
 * them. Stops at the first container that takes the count past `limit`, and walks with a list
 * rather than recursion, since the depth of the body is one of the things it is there to bound.
 */
export function holdsMoreValuesThan(body: unknown, limit: number): boolean {
  let values = 0;
  const pending: unknown[] = [body];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }

    const children: readonly unknown[] = Array.isArray(node) ? node : Object.values(node);
    values += children.length;
    if (values > limit) {
      return true;
    }
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        pending.push(child);
      }
    }
  }

  return false;
}

/**
 * Refuses a JSON body holding more than {@link MAX_JSON_BODY_VALUES} values before anything
 * validates it.
 *
 * Registered in `configureApp` straight after the body parsers, which is where the refusal is as
 * cheap as it gets: the body is already parsed, and nothing has walked it yet. It reads only what
 * the JSON parser produced, matching the `Content-Type` the way that parser does: a form body has
 * its own limit, and a multipart one is multer's.
 */
export function jsonValueLimit(req: Request, _res: Response, next: NextFunction): void {
  if (req.is('application/json') && holdsMoreValuesThan(req.body, MAX_JSON_BODY_VALUES)) {
    next(new PayloadTooLargeException(REQUEST_BODY_TOO_LARGE_MESSAGE));
    return;
  }

  next();
}
