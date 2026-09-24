import type { NextFunction, Request, Response } from 'express';
import { createAccessLogMiddleware, type AccessLogLine } from './access-log.middleware';
import type { RequestWithId } from './request-id';

type ResponseEvent = 'finish' | 'close';

interface FakeRes {
  statusCode: number;
  headersSent: boolean;
  once: (event: string, listener: () => void) => FakeRes;
  /** Emits `event` the way Node does: each `once` listener runs at most one time. */
  fire: (event: ResponseEvent) => void;
}

function createRes(statusCode = 200, headersSent = true): FakeRes {
  const listeners: Record<string, Array<() => void>> = {};
  const res: FakeRes = {
    statusCode,
    headersSent,
    once(event, listener) {
      (listeners[event] ??= []).push(listener);
      return res;
    },
    fire(event) {
      const pending = listeners[event] ?? [];
      listeners[event] = [];
      for (const listener of pending) {
        listener();
      }
    },
  };
  return res;
}

interface RequestOverrides {
  method?: string;
  originalUrl?: string;
  requestId?: string;
  user?: { id: string };
  ip?: string;
}

/** Runs one request through the middleware, then fires `events` on its response in order. */
function run(
  overrides: RequestOverrides,
  res: FakeRes,
  events: readonly ResponseEvent[],
): string[] {
  const lines: string[] = [];
  const middleware = createAccessLogMiddleware((line) => lines.push(line));

  const req = {
    method: 'GET',
    originalUrl: '/workspaces/w_1/tasks',
    url: '/workspaces/w_1/tasks',
    ip: '203.0.113.7',
    ...overrides,
  } as unknown as RequestWithId;
  const next = jest.fn();

  middleware(req as Request, res as unknown as Response, next as unknown as NextFunction);

  expect(next).toHaveBeenCalledTimes(1);
  // Nothing is written until the response has finished, or its connection has closed.
  expect(lines).toHaveLength(0);

  for (const event of events) {
    res.fire(event);
  }
  return lines;
}

function emit(
  overrides: RequestOverrides = {},
  statusCode = 200,
): { lines: string[]; parsed: AccessLogLine } {
  // A response that finished, which Node follows with `close`: still one line.
  const lines = run(overrides, createRes(statusCode), ['finish', 'close']);

  expect(lines).toHaveLength(1);
  return { lines, parsed: JSON.parse(lines[0] ?? '{}') as AccessLogLine };
}

/** A request whose connection closed before its response finished, so `finish` never came. */
function emitAborted(
  overrides: RequestOverrides = {},
  res: FakeRes = createRes(200, false),
): { lines: string[]; parsed: AccessLogLine } {
  const lines = run(overrides, res, ['close']);

  expect(lines).toHaveLength(1);
  return { lines, parsed: JSON.parse(lines[0] ?? '{}') as AccessLogLine };
}

describe('createAccessLogMiddleware', () => {
  it('writes exactly one JSON line per finished request', () => {
    const { lines, parsed } = emit();

    expect(lines[0]).not.toContain('\n');
    expect(parsed).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/workspaces/w_1/tasks',
      status: 200,
    });
    expect(typeof parsed.durationMs).toBe('number');
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it('carries the correlation id attached by requestIdMiddleware', () => {
    const { parsed } = emit({ requestId: '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d' });

    expect(parsed.requestId).toBe('0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d');
  });

  it('omits requestId instead of inventing one when correlation is absent', () => {
    const { parsed } = emit();

    expect('requestId' in parsed).toBe(false);
  });

  it('records the authenticated user resolved after the middleware ran', () => {
    // SessionAuthGuard attaches `user` during the Nest pipeline — long after this middleware
    // called next(), which is why the line is built on `finish` rather than up front.
    const { parsed } = emit({ user: { id: 'u_1' } });

    expect(parsed.userId).toBe('u_1');
  });

  it('omits userId for anonymous traffic', () => {
    expect('userId' in emit().parsed).toBe(false);
  });

  it("records Express's resolved client ip, not a raw header", () => {
    const { parsed } = emit({ ip: '198.51.100.23' });

    expect(parsed.ip).toBe('198.51.100.23');
  });

  it('falls back to a literal placeholder rather than omitting ip outright', () => {
    // Not a real scenario over the HTTP listener this app binds — `req.ip` is only ever
    // undefined here because a unit test built a bare object without it — but the field stays
    // in the closed set unconditionally, unlike userId/requestId, so a caller can always find
    // the key.
    const { parsed } = emit({ ip: undefined });

    expect(parsed.ip).toBe('unknown');
  });

  it.each<[number, AccessLogLine['level']]>([
    [200, 'info'],
    [201, 'info'],
    [304, 'info'],
    [400, 'warn'],
    [401, 'warn'],
    [404, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('logs %i at level %s', (status, level) => {
    expect(emit({}, status).parsed).toMatchObject({ status, level });
  });

  it('strips the query string, which carries user-supplied filters', () => {
    const { lines, parsed } = emit({
      originalUrl: '/workspaces/w_1/tasks?q=salary%20review&assigneeId=u_9',
    });

    expect(parsed.path).toBe('/workspaces/w_1/tasks');
    expect(lines[0]).not.toContain('salary');
    expect(lines[0]).not.toContain('assigneeId');
  });

  describe('secrets carried in the path itself', () => {
    // Better Auth mails `GET /auth/reset-password/<token>` and the recipient's browser follows
    // it, so unlike every other secret this API mints, this one is not in the query string that
    // the rule above throws away. A live token in stdout is spendable by anyone who reads the
    // log, for as long as the user takes to fill in the form.
    const TOKEN = 'gPsdiGDIlo68Stksnai06nuU';

    it('never writes the reset token, in the line or in the parsed path', () => {
      const { lines, parsed } = emit({
        originalUrl: `/auth/reset-password/${TOKEN}?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password`,
      });

      expect(parsed.path).toBe('/auth/reset-password/:token');
      expect(lines[0]).not.toContain(TOKEN);
    });

    it('redacts whatever follows the route, not just a single tidy segment', () => {
      expect(emit({ originalUrl: `/auth/reset-password/${TOKEN}/extra` }).parsed.path).toBe(
        '/auth/reset-password/:token',
      );
    });

    it('redacts the route however Express happened to case it', () => {
      const { lines, parsed } = emit({ originalUrl: `/auth/Reset-Password/${TOKEN}` });

      // The prefix keeps the casing it arrived with, so an oddly-cased request still reads as
      // the odd thing it is; only the secret is replaced.
      expect(parsed.path).toBe('/auth/Reset-Password/:token');
      expect(lines[0]).not.toContain(TOKEN);
    });

    it('leaves the tokenless route alone, so a 404 still reads as the path it was', () => {
      expect(emit({ originalUrl: '/auth/reset-password/' }, 404).parsed.path).toBe(
        '/auth/reset-password/',
      );
      // `POST /auth/reset-password` carries its token in the body, which is never logged.
      expect(emit({ method: 'POST', originalUrl: '/auth/reset-password' }).parsed.path).toBe(
        '/auth/reset-password',
      );
    });

    it('leaves ordinary paths untouched', () => {
      expect(emit({ originalUrl: '/auth/sign-in/email' }).parsed.path).toBe('/auth/sign-in/email');
    });
  });

  it('logs no field beyond the closed set — no headers, cookies or body', () => {
    const { parsed } = emit({ requestId: 'req-abcdefgh', user: { id: 'u_1' } });

    expect(Object.keys(parsed).sort()).toEqual([
      'durationMs',
      'ip',
      'level',
      'method',
      'path',
      'requestId',
      'status',
      'ts',
      'userId',
    ]);
  });

  /**
   * A response whose connection is gone never emits `finish`, so until the middleware listened for
   * `close` too, a client that left mid-body, or while its handler ran, or partway through a
   * download left no line at all (measured through `configureApp`; the real sockets are in
   * `configure-app.spec.ts`).
   */
  describe('a request whose connection closed before its response finished', () => {
    it('still gets its line, marked aborted, with no status when none was sent', () => {
      const { lines, parsed } = emitAborted({
        method: 'POST',
        originalUrl: '/workspaces/w_1/tasks/t_1/attachments',
        requestId: 'req-abcdefgh',
      });

      expect(lines[0]).not.toContain('\n');
      expect(parsed).toMatchObject({
        level: 'warn',
        requestId: 'req-abcdefgh',
        method: 'POST',
        path: '/workspaces/w_1/tasks/t_1/attachments',
        status: null,
        aborted: true,
        ip: '203.0.113.7',
      });
      expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('never reports a status the client was not sent', () => {
      // Measured: Nest sets a route's `@HttpCode` on the response ahead of the handler, so an
      // upload whose client left read 201 on `res.statusCode` with nothing written at all.
      expect(emitAborted({}, createRes(201, false)).parsed).toMatchObject({
        status: null,
        level: 'warn',
      });
    });

    it.each<[number, AccessLogLine['level']]>([
      [200, 'info'],
      [404, 'warn'],
      [503, 'error'],
    ])('keeps a %i that went out, at level %s, when the body was cut short', (status, level) => {
      // A download whose client left partway: the status line reached it, the body did not.
      expect(emitAborted({}, createRes(status, true)).parsed).toMatchObject({
        status,
        level,
        aborted: true,
      });
    });

    it('logs the same closed set, plus the marker', () => {
      const { parsed } = emitAborted({ requestId: 'req-abcdefgh', user: { id: 'u_1' } });

      expect(Object.keys(parsed).sort()).toEqual([
        'aborted',
        'durationMs',
        'ip',
        'level',
        'method',
        'path',
        'requestId',
        'status',
        'ts',
        'userId',
      ]);
    });
  });

  it.each<[string, ResponseEvent[]]>([
    ['finished, then closed', ['finish', 'close']],
    ['closed, then finished', ['close', 'finish']],
    ['closed twice', ['close', 'close']],
  ])('writes one line, never two, for a response %s', (_order, events) => {
    // Node emits `close` after `finish` on every response that finished; the other orders cannot
    // happen, and the guard holds either way.
    expect(run({}, createRes(200), events)).toHaveLength(1);
  });

  it('marks nothing on a response that finished', () => {
    expect('aborted' in emit().parsed).toBe(false);
  });

  it('covers non-GET methods', () => {
    expect(emit({ method: 'DELETE' }, 204).parsed).toMatchObject({
      method: 'DELETE',
      status: 204,
      level: 'info',
    });
  });
});
