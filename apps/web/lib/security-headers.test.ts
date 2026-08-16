import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, getSecurityHeaders } from './security-headers';

const API_URL = 'https://api.example.com';

/** Pulls one directive's value list out of a CSP string, the way a browser would parse it. */
function directive(csp: string, name: string): string[] | undefined {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found?.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('getSecurityHeaders', () => {
  const headers = getSecurityHeaders(API_URL);

  function value(key: string): string {
    const header = headers.find((entry) => entry.key === key);
    expect(header, `expected a ${key} header`).toBeDefined();
    return header?.value ?? '';
  }

  it('sends exactly the six baseline headers, no duplicates', () => {
    expect(headers.map((header) => header.key)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
  });

  it('denies framing at both the CSP and the legacy header', () => {
    expect(value('X-Frame-Options')).toBe('DENY');
    expect(directive(value('Content-Security-Policy'), 'frame-ancestors')).toEqual(["'none'"]);
  });

  it('sends HSTS with a one-year max-age covering subdomains', () => {
    expect(value('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });

  it('stops MIME-sniffing', () => {
    expect(value('X-Content-Type-Options')).toBe('nosniff');
  });

  it('caps the referrer at strict-origin-when-cross-origin', () => {
    expect(value('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('denies every powerful-feature permission it lists, including FLoC opt-out', () => {
    const policy = value('Permissions-Policy');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('interest-cohort=()');
  });

  it('defaults to same-origin only, closing off base and form-action pivots', () => {
    const csp = value('Content-Security-Policy');
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
  });
});

describe('buildContentSecurityPolicy', () => {
  it('puts the configured API origin into connect-src alongside self', () => {
    const csp = buildContentSecurityPolicy(API_URL);
    expect(directive(csp, 'connect-src')).toEqual(
      expect.arrayContaining(["'self'", 'https://api.example.com']),
    );
  });

  it('derives a wss origin from an https API origin for the Socket.io transport', () => {
    const csp = buildContentSecurityPolicy('https://api.example.com');
    expect(directive(csp, 'connect-src')).toContain('wss://api.example.com');
  });

  it('derives a ws origin from a plain-http API origin (local dev)', () => {
    const csp = buildContentSecurityPolicy('http://localhost:4000');
    expect(directive(csp, 'connect-src')).toContain('ws://localhost:4000');
  });

  it('collapses connect-src to self for a same-origin API, naming no origin at all', () => {
    // The shipped image bakes `/api`. This header is static Next config evaluated once at
    // build time, so anything host-specific in it would make the image deployment-specific
    // again — the exact coupling audit finding PM-02 is about. `'self'` is the only value
    // that is already correct on every domain, and per CSP Level 3 it also covers the
    // same-origin WebSocket upgrade Socket.io needs.
    expect(directive(buildContentSecurityPolicy('/api'), 'connect-src')).toEqual(["'self'"]);
    expect(directive(buildContentSecurityPolicy(''), 'connect-src')).toEqual(["'self'"]);
  });

  it('does not try to derive a ws origin from a path, which has none', () => {
    // `new URL('/api')` throws. Reaching it would take down `next build` itself rather than
    // produce a wrong header, but the failure would be a stack trace in a config file — worth
    // a test that says which input must never get there.
    expect(() => buildContentSecurityPolicy('/api')).not.toThrow();
  });

  it('lets an image attachment be previewed from a blob, without opening img-src to a host', () => {
    // `'self'` does not cover the `blob:` scheme, so an object URL is blocked unless the
    // scheme is listed. The preview in `attachment-row.tsx` fetches the bytes through
    // `lib/api.ts` and renders them from `URL.createObjectURL`; drop `blob:` here and that
    // image is refused on every topology, same-origin API included.
    const csp = buildContentSecurityPolicy(API_URL);
    expect(directive(csp, 'img-src')).toEqual(["'self'", 'blob:']);
  });

  it('never widens img-src to an API host, however the API is addressed', () => {
    // The reason the preview goes through `fetch` at all: naming the API origin here would let
    // markup injection render any API response as an image on a split-domain deployment.
    for (const base of [API_URL, '/api', 'http://localhost:4000']) {
      expect(directive(buildContentSecurityPolicy(base), 'img-src')).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
      );
    }
  });

  it('allows inline script and style, which the app measurably needs', () => {
    const csp = buildContentSecurityPolicy(API_URL);
    expect(directive(csp, 'script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(csp, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('never allows a remote script or style host, only inline', () => {
    const csp = buildContentSecurityPolicy(API_URL);
    expect(directive(csp, 'script-src')).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
    );
    expect(directive(csp, 'style-src')).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
    );
  });
});
