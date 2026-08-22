import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

/**
 * The route guard at its only interesting decision — what a signed-out visitor is sent to —
 * and the CSP it now mints for every response it produces.
 *
 * The nonce assertions matter here rather than in `lib/security-headers.test.ts` because the
 * builder is pure: it will happily stamp the same nonce into a thousand policies. Whether the
 * value is fresh per request, and whether it reaches the renderer at all, are properties of
 * *this* file, and both are silent when broken — a stale nonce still produces a page that
 * loads, and a nonce set on the response but not on the forwarded request produces a page
 * whose scripts are all blocked in the browser and nowhere else.
 */

const fetchMock = vi.fn<typeof fetch>();

function request(url: string, signedIn: boolean): NextRequest {
  return new NextRequest(url, { headers: signedIn ? { cookie: 'session=1' } : {} });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** The `'nonce-…'` value a browser would take out of the policy, or `null` if there is none. */
function nonceOf(csp: string | null): string | null {
  return csp?.match(/script-src [^;]*'nonce-([^']+)'/)?.[1] ?? null;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(jsonResponse({ user: { id: 'u1' } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proxy', () => {
  it('names the protected route the visitor was refused, so signing in returns them to it', async () => {
    const response = await proxy(request('http://localhost:3000/boards/abc', false));

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent('/boards/abc')}`,
    );
  });

  it('keeps the deep link whole by putting its query string inside the parameter', async () => {
    // Left where they were, the board's own parameters would arrive as sign-in parameters and
    // be dropped on the way back — the visitor would land on the board without their filter.
    const response = await proxy(request('http://localhost:3000/boards/abc?label=slot-1', false));

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent('/boards/abc?label=slot-1')}`,
    );
  });

  it('lets an invitation through unauthenticated, since that page runs the sign-in detour itself', async () => {
    const response = await proxy(request('http://localhost:3000/invite/abc', false));

    expect(response.headers.get('location')).toBeNull();
  });

  it('leaves a signed-in visitor on the route they asked for', async () => {
    const response = await proxy(request('http://localhost:3000/boards/abc', true));

    expect(response.headers.get('location')).toBeNull();
  });

  it('sends a nonced policy with no unsafe-inline script source', async () => {
    const csp = (await proxy(request('http://localhost:3000/dashboard', true))).headers.get(
      'content-security-policy',
    );

    expect(csp).toBeTruthy();
    expect(nonceOf(csp)).toBeTruthy();
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('mints a different nonce for every request', async () => {
    // The single property that makes this worth doing at all. Memoising the nonce anywhere —
    // module scope, a cached policy string — would leave every other test in this file green.
    const nonces = await Promise.all(
      Array.from({ length: 20 }, async () =>
        nonceOf(
          (await proxy(request('http://localhost:3000/dashboard', true))).headers.get(
            'content-security-policy',
          ),
        ),
      ),
    );

    expect(new Set(nonces).size).toBe(20);
  });

  it('forwards the same policy on the request, which is where Next reads the nonce from', async () => {
    // Next parses `'nonce-…'` off the *incoming request* to stamp its own hydration and bundle
    // scripts. Set the header on the response alone and every page still renders here, in the
    // API tests, and in jsdom — and every script in it is refused by a real browser.
    const response = await proxy(request('http://localhost:3000/dashboard', true));
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(forwarded).toBe(response.headers.get('content-security-policy'));
  });

  it('hands the nonce to the renderer under x-nonce, for the inline script Next does not own', async () => {
    // `app/layout.tsx` reads this one and passes it to `next-themes`.
    const response = await proxy(request('http://localhost:3000/dashboard', true));

    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(
      nonceOf(response.headers.get('content-security-policy')),
    );
  });

  it('covers the public pages, which return before the session check', async () => {
    for (const path of ['/login', '/register', '/verify-email', '/invite/abc']) {
      const response = await proxy(request(`http://localhost:3000${path}`, false));
      expect(nonceOf(response.headers.get('content-security-policy')), path).toBeTruthy();
    }
  });

  it('covers the root redirect, both signed in and out', async () => {
    for (const signedIn of [true, false]) {
      const response = await proxy(request('http://localhost:3000/', signedIn));
      expect(response.headers.get('location')).toContain(signedIn ? '/dashboard' : '/login');
      expect(nonceOf(response.headers.get('content-security-policy'))).toBeTruthy();
    }
  });

  it('covers a path that looks like a file, without spending an API round trip on it', async () => {
    // Nothing in `public/` answers these, so `app/not-found.tsx` does — HTML, with the same
    // inline hydration scripts as any other page.
    const response = await proxy(request('http://localhost:3000/robots.txt', false));

    expect(nonceOf(response.headers.get('content-security-policy'))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
