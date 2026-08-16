import { describe, expect, it } from 'vitest';
import {
  DEV_API_BASE_URL,
  isSameOriginApiBaseUrl,
  resolveApiBaseUrl,
  resolveApiOrigin,
  resolveServerApiBaseUrl,
} from './api-url';

describe('resolveApiBaseUrl', () => {
  it('keeps a same-origin path, which is what makes one image serve every domain', () => {
    // The regression this guards is the whole of audit finding PM-02: if the browser base
    // ever becomes an absolute origin again by default, the published web image is once more
    // specific to one deployment and has to be rebuilt per install.
    expect(resolveApiBaseUrl('/api')).toBe('/api');
  });

  it('keeps an absolute origin for a deployment that puts the API on its own domain', () => {
    expect(resolveApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
  });

  it('drops a trailing slash so an appended path cannot produce a double slash', () => {
    expect(resolveApiBaseUrl('/api/')).toBe('/api');
    expect(resolveApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('normalises a bare slash to the empty prefix, i.e. the API at this origin’s root', () => {
    expect(resolveApiBaseUrl('/')).toBe('');
    expect(isSameOriginApiBaseUrl(resolveApiBaseUrl('/'))).toBe(true);
  });

  it('treats unset and blank alike, rather than letting blank mean "this origin"', () => {
    // `NEXT_PUBLIC_API_URL=` left in a .env is the realistic case. Passing it through as `''`
    // would silently point every request at the web app itself, which answers with this app's
    // 404 page instead of an API error — a failure that reads as "the app is broken", not as
    // "a variable is empty".
    expect(resolveApiBaseUrl(undefined)).toBe(DEV_API_BASE_URL);
    expect(resolveApiBaseUrl('')).toBe(DEV_API_BASE_URL);
    expect(resolveApiBaseUrl('   ')).toBe(DEV_API_BASE_URL);
  });
});

describe('isSameOriginApiBaseUrl', () => {
  it('recognises a path base', () => {
    expect(isSameOriginApiBaseUrl('/api')).toBe(true);
    expect(isSameOriginApiBaseUrl('')).toBe(true);
  });

  it('does not mistake an origin for one', () => {
    expect(isSameOriginApiBaseUrl('https://api.example.com')).toBe(false);
    expect(isSameOriginApiBaseUrl('http://localhost:4000')).toBe(false);
  });
});

describe('resolveApiOrigin', () => {
  it('gives Better Auth an absolute origin, never a path', () => {
    // `createAuthClient` runs `new URL(baseURL)` in its constructor and throws
    // `BetterAuthError: Invalid base URL: /api` on a path. That happens at module import, so
    // it blanks the whole page rather than failing one request — a real browser-visible
    // outage seen while building the same-origin topology, not a hypothetical.
    const origin = resolveApiOrigin('/api', 'https://kurul.example.com');
    expect(origin).toBe('https://kurul.example.com');
    expect(() => new URL(origin)).not.toThrow();
  });

  it('drops the API path prefix, because Better Auth would ignore basePath otherwise', () => {
    // A `baseURL` carrying a path makes Better Auth treat that path as its mount point and
    // ignore `basePath` entirely: `…/api` + `basePath: '/auth'` produced requests to
    // `/api/sign-up/email`, the `/auth` segment silently gone, answered with 404 and shown as
    // a generic "could not create your account". Better Auth is served at `/auth` on the
    // origin root and the proxy forwards that path unchanged, so the prefix must not leak in.
    expect(resolveApiOrigin('/api', 'https://kurul.example.com')).toBe('https://kurul.example.com');
    expect(resolveApiOrigin('https://example.com/api', 'https://example.com')).toBe(
      'https://example.com',
    );
  });

  it('keeps an API that owns its own host', () => {
    expect(resolveApiOrigin('https://api.example.com', 'https://app.example.com')).toBe(
      'https://api.example.com',
    );
    expect(resolveApiOrigin('', 'https://kurul.example.com')).toBe('https://kurul.example.com');
  });
});

describe('resolveServerApiBaseUrl', () => {
  it('never returns a path — server-side fetch has no origin to resolve one against', () => {
    // The same-origin build is the shipped default, so this is the branch that runs in every
    // container: middleware's session probe and the locale lookup would both throw
    // `Failed to parse URL from /api/...` if a path leaked through here.
    const base = resolveServerApiBaseUrl({
      internalApiUrl: 'http://api:4000',
      publicApiUrl: '/api',
    });
    expect(base).toBe('http://api:4000');
    expect(isSameOriginApiBaseUrl(base)).toBe(false);
  });

  it('prefers the internal address even over an absolute public one', () => {
    // The browser's route to the API and the server's are allowed to differ; when they do,
    // only the container-network address resolves from inside the container.
    expect(
      resolveServerApiBaseUrl({
        internalApiUrl: 'http://api:4000',
        publicApiUrl: 'https://api.example.com',
      }),
    ).toBe('http://api:4000');
  });

  it('falls back to the absolute public base when no internal address is configured', () => {
    expect(
      resolveServerApiBaseUrl({
        internalApiUrl: undefined,
        publicApiUrl: 'https://api.example.com',
      }),
    ).toBe('https://api.example.com');
  });

  it('falls back to the dev API rather than to an unusable path', () => {
    expect(resolveServerApiBaseUrl({ internalApiUrl: undefined, publicApiUrl: '/api' })).toBe(
      DEV_API_BASE_URL,
    );
    expect(resolveServerApiBaseUrl({ internalApiUrl: '', publicApiUrl: undefined })).toBe(
      DEV_API_BASE_URL,
    );
  });

  it('drops a trailing slash on the internal address too', () => {
    expect(
      resolveServerApiBaseUrl({ internalApiUrl: 'http://api:4000/', publicApiUrl: '/api' }),
    ).toBe('http://api:4000');
  });
});
