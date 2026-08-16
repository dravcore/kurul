import type { NextFunction, Request, Response } from 'express';
import { UUID_V7_REGEX } from '../uuid';
import {
  REQUEST_ID_HEADER,
  getRequestId,
  requestIdMiddleware,
  sanitizeRequestId,
  type RequestWithId,
} from './request-id';

function createReq(headers: Record<string, unknown> = {}): RequestWithId {
  return { headers } as unknown as RequestWithId;
}

function createRes(): { res: Response; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  return { res: { setHeader } as unknown as Response, setHeader };
}

function run(headers: Record<string, unknown> = {}): {
  req: RequestWithId;
  setHeader: jest.Mock;
  next: jest.Mock;
} {
  const req = createReq(headers);
  const { res, setHeader } = createRes();
  const next = jest.fn();

  requestIdMiddleware(req as Request, res, next as unknown as NextFunction);

  return { req, setHeader, next };
}

describe('sanitizeRequestId', () => {
  it('accepts a URL-safe id of a reasonable length', () => {
    expect(sanitizeRequestId('0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d')).toBe(
      '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d',
    );
    expect(sanitizeRequestId('trace_id.1~2-3')).toBe('trace_id.1~2-3');
  });

  it.each<[string, unknown]>([
    ['a non-string', 42],
    ['undefined (header absent)', undefined],
    ['a comma-joined duplicate header', 'aaaaaaaa, bbbbbbbb'],
    ['a value too short to be an id', 'abc'],
    ['a value past the length cap', 'a'.repeat(129)],
    ['whitespace', 'has space'],
    ['a CRLF header-injection attempt', 'abcdefgh\r\nX-Admin: 1'],
    ['markup', '<script>alert(1)</script>'],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeRequestId(value)).toBeUndefined();
  });
});

describe('requestIdMiddleware', () => {
  it('generates a UUIDv7 when no id arrives with the request', () => {
    const { req, setHeader, next } = run();

    expect(req.requestId).toMatch(UUID_V7_REGEX);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a distinct id per request', () => {
    expect(run().req.requestId).not.toBe(run().req.requestId);
  });

  it('reuses a safe inbound X-Request-Id so an upstream trace is not broken', () => {
    const { req, setHeader } = run({ 'x-request-id': 'edge-7f3a9c21b4d0' });

    expect(req.requestId).toBe('edge-7f3a9c21b4d0');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'edge-7f3a9c21b4d0');
  });

  it('replaces an unsafe inbound id rather than echoing it back', () => {
    const { req, setHeader } = run({ 'x-request-id': 'bad\r\nX-Admin: 1' });

    expect(req.requestId).toMatch(UUID_V7_REGEX);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
  });
});

describe('getRequestId', () => {
  it('reads the id the middleware attached', () => {
    const { req } = run({ 'x-request-id': 'edge-7f3a9c21b4d0' });

    expect(getRequestId(req)).toBe('edge-7f3a9c21b4d0');
  });

  it('returns undefined when the middleware never ran', () => {
    expect(getRequestId(createReq())).toBeUndefined();
    expect(getRequestId(undefined)).toBeUndefined();
    expect(getRequestId(null)).toBeUndefined();
  });
});
