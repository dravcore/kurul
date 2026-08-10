import { describe, expect, it } from 'vitest';
import { ApiError, apiStatus, resolveApiMessage } from './api';

const t = (key: string): string => `t:${key}`;

function apiError(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Error', message: 'boom' });
}

describe('apiStatus', () => {
  it('reads the status off an ApiError', () => {
    expect(apiStatus(apiError(403))).toBe(403);
  });

  it('is null for a failure that never reached a response', () => {
    expect(apiStatus(new TypeError('network'))).toBeNull();
    expect(apiStatus('nope')).toBeNull();
  });
});

describe('resolveApiMessage', () => {
  it('prefers the key mapped to the status', () => {
    expect(
      resolveApiMessage(apiError(403), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:forbidden');
  });

  it('falls back for an unmapped status', () => {
    expect(
      resolveApiMessage(apiError(500), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:deleteError');
  });

  it('falls back for a non-ApiError failure', () => {
    expect(
      resolveApiMessage(new TypeError('network'), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:deleteError');
  });

  it('works without any status mapping', () => {
    expect(resolveApiMessage(apiError(403), t, { fallback: 'createError' })).toBe('t:createError');
  });
});
