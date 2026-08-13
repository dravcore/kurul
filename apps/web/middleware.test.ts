import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/**
 * The route guard, exercised at its only interesting decision: what a signed-out visitor is
 * sent to. The redirect has to name where they were going, or the page they asked for is lost
 * the moment they sign in.
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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(jsonResponse({ user: { id: 'u1' } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('middleware', () => {
  it('names the protected route the visitor was refused, so signing in returns them to it', async () => {
    const response = await middleware(request('http://localhost:3000/boards/abc', false));

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent('/boards/abc')}`,
    );
  });

  it('keeps the deep link whole by putting its query string inside the parameter', async () => {
    // Left where they were, the board's own parameters would arrive as sign-in parameters and
    // be dropped on the way back — the visitor would land on the board without their filter.
    const response = await middleware(
      request('http://localhost:3000/boards/abc?label=slot-1', false),
    );

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent('/boards/abc?label=slot-1')}`,
    );
  });

  it('lets an invitation through unauthenticated, since that page runs the sign-in detour itself', async () => {
    const response = await middleware(request('http://localhost:3000/invite/abc', false));

    expect(response.headers.get('location')).toBeNull();
  });

  it('leaves a signed-in visitor on the route they asked for', async () => {
    const response = await middleware(request('http://localhost:3000/boards/abc', true));

    expect(response.headers.get('location')).toBeNull();
  });
});
