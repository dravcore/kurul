import { PassThrough } from 'node:stream';
import {
  AUTH_BODY_MAX_BYTES,
  AuthBodyTooLargeError,
  boundStreamedBody,
  declaredBodyBytes,
  declaresOversizedBody,
} from './auth-body-limit';

/**
 * The pure half of the `/auth/*` body ceiling. The mount that applies it is exercised end to
 * end in `test/auth.e2e-spec.ts` (the real Better Auth handler, a real socket); what this file
 * pins is the arithmetic and the stream mechanics, with a ceiling small enough to trip in a
 * few chunks.
 */
describe('AUTH_BODY_MAX_BYTES', () => {
  it('is 64 KiB', () => {
    expect(AUTH_BODY_MAX_BYTES).toBe(64 * 1024);
  });
});

describe('declaredBodyBytes', () => {
  it('reads a declared Content-Length', () => {
    expect(declaredBodyBytes({ headers: { 'content-length': '512' } })).toBe(512);
    expect(declaredBodyBytes({ headers: { 'content-length': '0' } })).toBe(0);
  });

  it('is null for a chunked or body-less request', () => {
    expect(declaredBodyBytes({ headers: {} })).toBeNull();
    expect(declaredBodyBytes({ headers: { 'transfer-encoding': 'chunked' } })).toBeNull();
  });

  it('is null rather than NaN for a value the HTTP parser would never let through', () => {
    expect(declaredBodyBytes({ headers: { 'content-length': 'abc' } })).toBeNull();
    expect(declaredBodyBytes({ headers: { 'content-length': '-1' } })).toBeNull();
  });
});

describe('declaresOversizedBody', () => {
  it('accepts a body of exactly the ceiling and refuses one byte more', () => {
    expect(
      declaresOversizedBody({ headers: { 'content-length': String(AUTH_BODY_MAX_BYTES) } }),
    ).toBe(false);
    expect(
      declaresOversizedBody({ headers: { 'content-length': String(AUTH_BODY_MAX_BYTES + 1) } }),
    ).toBe(true);
  });

  it('cannot refuse what it cannot measure: a chunked body is left to the streaming guard', () => {
    expect(declaresOversizedBody({ headers: { 'transfer-encoding': 'chunked' } })).toBe(false);
  });
});

describe('boundStreamedBody', () => {
  const CEILING = 100;

  function chunk(bytes: number): Buffer {
    return Buffer.alloc(bytes, 'x');
  }

  /**
   * Not `events.once(req, 'close')`: that helper rejects as soon as an `'error'` event lands,
   * and an error landing is exactly what the cut is supposed to produce.
   */
  function closed(req: PassThrough): Promise<void> {
    return new Promise((resolve) => req.once('close', () => resolve()));
  }

  function ended(req: PassThrough): Promise<void> {
    return new Promise((resolve) => req.once('end', () => resolve()));
  }

  it('leaves a body at or under the ceiling untouched, and lets a reader see every byte', async () => {
    // `autoDestroy: false`, or a stream that ended normally reads as destroyed too.
    const req = new PassThrough({ autoDestroy: false });
    const seen: Buffer[] = [];
    const errors: unknown[] = [];
    req.on('error', (error) => errors.push(error));
    // The reader that got there first, as Better Auth's does.
    req.on('data', (data: Buffer) => seen.push(data));
    boundStreamedBody(req, CEILING);

    req.write(chunk(60));
    req.write(chunk(40));
    req.end();
    await ended(req);

    expect(req.destroyed).toBe(false);
    expect(errors).toEqual([]);
    expect(Buffer.concat(seen).length).toBe(CEILING);
  });

  it('destroys the request the moment the count passes the ceiling, with a named error', async () => {
    const req = new PassThrough();
    const errors: unknown[] = [];
    req.on('error', (error) => errors.push(error));
    req.on('data', () => undefined);
    boundStreamedBody(req, CEILING);

    req.write(chunk(60));
    req.write(chunk(41));
    await closed(req);

    expect(req.destroyed).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AuthBodyTooLargeError);
    expect((errors[0] as Error).message).toContain(String(CEILING));
  });

  it('does not throw when nobody else is listening for the error', async () => {
    // A request Better Auth declined to read attaches no `error` listener of its own; the cut
    // must still be silent rather than an uncaught 'error' event that takes the process down.
    const req = new PassThrough();
    boundStreamedBody(req, CEILING);

    req.write(chunk(CEILING + 1));
    await closed(req);

    expect(req.destroyed).toBe(true);
  });

  it('counts string chunks by their byte length, not their character count', async () => {
    const req = new PassThrough({ encoding: 'utf8' });
    req.on('error', () => undefined);
    boundStreamedBody(req, CEILING);

    // 51 two-byte characters: 51 characters, 102 bytes.
    req.write('é'.repeat(51));
    await closed(req);

    expect(req.destroyed).toBe(true);
  });
});
