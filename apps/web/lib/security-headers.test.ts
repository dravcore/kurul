import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createCspNonce, getSecurityHeaders } from './security-headers';

const API_URL = 'https://api.example.com';
const NONCE = 'dGVzdC1ub25jZS12YWx1ZQ==';

/** Pulls one directive's value list out of a CSP string, the way a browser would parse it. */
function directive(csp: string, name: string): string[] | undefined {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found?.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('getSecurityHeaders', () => {
  const headers = getSecurityHeaders();

  function value(key: string): string {
    const header = headers.find((entry) => entry.key === key);
    expect(header, `expected a ${key} header`).toBeDefined();
    return header?.value ?? '';
  }

  it('sends exactly the five constant headers, no duplicates', () => {
    expect(headers.map((header) => header.key)).toEqual([
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
  });

  it('leaves Content-Security-Policy to the proxy, so no response can carry two of them', () => {
    // Both a static `headers()` entry and a per-request one would arrive as two policies, and
    // a browser enforces the *intersection* of every policy it is sent: the nonced inline
    // scripts would survive, but the static policy's `'unsafe-inline'` would keep the weaker
    // rule alive for anything the nonce did not cover. One header, one source.
    expect(headers.map((header) => header.key)).not.toContain('Content-Security-Policy');
  });

  it('denies framing at the legacy header, which CSP frame-ancestors backs up', () => {
    expect(value('X-Frame-Options')).toBe('DENY');
    expect(directive(buildContentSecurityPolicy(API_URL, NONCE), 'frame-ancestors')).toEqual([
      "'none'",
    ]);
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
});

describe('createCspNonce', () => {
  it('never repeats a value, which is the only property that makes a nonce one', () => {
    // A nonce that recurs is a password an attacker only has to observe once. 1000 draws is
    // not proof of 128 bits of entropy, but it does fail loudly on the mistake that actually
    // happens: a "nonce" derived from something stable, or memoised at module scope.
    const drawn = new Set(Array.from({ length: 1000 }, () => createCspNonce()));
    expect(drawn.size).toBe(1000);
  });

  it('encodes 16 random bytes, so the value carries the 128 bits CSP asks for', () => {
    expect(atob(createCspNonce())).toHaveLength(16);
  });

  it('stays inside CSP base64-value, so it needs no escaping inside the quotes', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(createCspNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });
});

describe('buildContentSecurityPolicy', () => {
  it('puts the configured API origin into connect-src alongside self', () => {
    const csp = buildContentSecurityPolicy(API_URL, NONCE);
    expect(directive(csp, 'connect-src')).toEqual(
      expect.arrayContaining(["'self'", 'https://api.example.com']),
    );
  });

  it('derives a wss origin from an https API origin for the Socket.io transport', () => {
    const csp = buildContentSecurityPolicy('https://api.example.com', NONCE);
    expect(directive(csp, 'connect-src')).toContain('wss://api.example.com');
  });

  it('derives a ws origin from a plain-http API origin (local dev)', () => {
    const csp = buildContentSecurityPolicy('http://localhost:4000', NONCE);
    expect(directive(csp, 'connect-src')).toContain('ws://localhost:4000');
  });

  it('collapses connect-src to self for a same-origin API, naming no origin at all', () => {
    // The shipped image bakes `/api`. The rest of this policy is per-request now, but
    // `NEXT_PUBLIC_API_URL` is still inlined at build time, so anything host-specific derived
    // from it would make the image deployment-specific again — the exact coupling audit
    // finding PM-02 is about. `'self'` is the only value that is already correct on every
    // domain, and per CSP Level 3 it also covers the same-origin WebSocket upgrade Socket.io
    // needs.
    expect(directive(buildContentSecurityPolicy('/api', NONCE), 'connect-src')).toEqual(["'self'"]);
    expect(directive(buildContentSecurityPolicy('', NONCE), 'connect-src')).toEqual(["'self'"]);
  });

  it('does not try to derive a ws origin from a path, which has none', () => {
    // `new URL('/api')` throws. Reaching it would take down every render rather than produce a
    // wrong header, but the failure would be a stack trace from a header builder — worth a
    // test that says which input must never get there.
    expect(() => buildContentSecurityPolicy('/api', NONCE)).not.toThrow();
  });

  it('lets an image attachment be previewed from a blob, without opening img-src to a host', () => {
    // `'self'` does not cover the `blob:` scheme, so an object URL is blocked unless the
    // scheme is listed. The preview in `attachment-row.tsx` fetches the bytes through
    // `lib/api.ts` (which is what `connect-src` governs) and renders them from
    // `URL.createObjectURL`; drop `blob:` here and that image is refused on every topology,
    // same-origin API included.
    const csp = buildContentSecurityPolicy(API_URL, NONCE);
    expect(directive(csp, 'img-src')).toEqual(["'self'", 'blob:']);
  });

  it('never widens img-src to an API host, however the API is addressed', () => {
    // The reason the preview goes through `fetch` at all: naming the API origin here would let
    // markup injection render any API response as an image on a split-domain deployment.
    for (const base of [API_URL, '/api', 'http://localhost:4000']) {
      expect(directive(buildContentSecurityPolicy(base, NONCE), 'img-src')).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
      );
    }
  });

  it('admits inline script only by nonce, never by blanket unsafe-inline', () => {
    // The acceptance criterion for the whole change: an injected `<script>` in reflected
    // markup cannot guess the nonce, so it does not run.
    expect(directive(buildContentSecurityPolicy(API_URL, NONCE), 'script-src')).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
    ]);
  });

  it('names the nonce it was given, so the header and the rendered scripts cannot disagree', () => {
    const csp = buildContentSecurityPolicy(API_URL, 'AAAABBBBCCCCDDDD');
    expect(csp).toContain("'nonce-AAAABBBBCCCCDDDD'");
    expect(csp).not.toContain(NONCE);
  });

  it('keeps unsafe-inline for style, which no nonce can replace', () => {
    // Radix and `@dnd-kit` position elements through the inline `style` *attribute*, and a
    // nonce applies to `<style>` elements only — there is no nonce variant of this trade-off
    // to make. Asserted rather than left implicit so that removing it is a deliberate act.
    expect(directive(buildContentSecurityPolicy(API_URL, NONCE), 'style-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it('never allows a remote script or style host, only inline', () => {
    const csp = buildContentSecurityPolicy(API_URL, NONCE);
    expect(directive(csp, 'script-src')).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
    );
    expect(directive(csp, 'style-src')).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
    );
  });

  it('defaults to same-origin only, closing off base and form-action pivots', () => {
    const csp = buildContentSecurityPolicy(API_URL, NONCE);
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
  });
});
