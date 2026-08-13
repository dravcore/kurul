import type { NextFunction, Request, Response } from 'express';
import { createAccessLogMiddleware, type AccessLogLine } from './access-log.middleware';
import type { RequestWithId } from './request-id';

interface FakeRes {
  statusCode: number;
  once: (event: string, listener: () => void) => FakeRes;
  finish: () => void;
}

function createRes(statusCode = 200): FakeRes {
  const listeners: Record<string, Array<() => void>> = {};
  const res: FakeRes = {
    statusCode,
    once(event, listener) {
      (listeners[event] ??= []).push(listener);
      return res;
    },
    finish() {
      for (const listener of listeners.finish ?? []) {
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
}

function emit(
  overrides: RequestOverrides = {},
  statusCode = 200,
): { lines: string[]; parsed: AccessLogLine } {
  const lines: string[] = [];
  const middleware = createAccessLogMiddleware((line) => lines.push(line));

  const req = {
    method: 'GET',
    originalUrl: '/workspaces/w_1/tasks',
    url: '/workspaces/w_1/tasks',
    ...overrides,
  } as unknown as RequestWithId;
  const res = createRes(statusCode);
  const next = jest.fn();

  middleware(req as Request, res as unknown as Response, next as unknown as NextFunction);

  expect(next).toHaveBeenCalledTimes(1);
  // Nothing is written until the response is actually finished.
  expect(lines).toHaveLength(0);

  res.finish();

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

  it('logs no field beyond the closed set — no headers, cookies or body', () => {
    const { parsed } = emit({ requestId: 'req-abcdefgh', user: { id: 'u_1' } });

    expect(Object.keys(parsed).sort()).toEqual([
      'durationMs',
      'level',
      'method',
      'path',
      'requestId',
      'status',
      'ts',
      'userId',
    ]);
  });

  it('covers non-GET methods', () => {
    expect(emit({ method: 'DELETE' }, 204).parsed).toMatchObject({
      method: 'DELETE',
      status: 204,
      level: 'info',
    });
  });
});
