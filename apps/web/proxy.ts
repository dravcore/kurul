import { NextResponse, type NextRequest } from 'next/server';
import { getApiBaseUrl } from '@/lib/api';
import { getServerApiBaseUrl } from '@/lib/api-url';
import { NEXT_PARAM } from '@/lib/auth-redirect';
import {
  buildContentSecurityPolicy,
  createCspNonce,
  CSP_NONCE_HEADER,
} from '@/lib/security-headers';

/**
 * `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention, and the old filename now
 * logs a deprecation warning on every build (`next/dist/build/index.js` refuses outright if
 * both files exist). The export is `proxy`; nothing else about how it runs changed.
 */

// `/verify-email` is public because a link can fail before anyone is signed in: Better Auth
// only signs the user in when the token was *good*, so bouncing an unauthenticated visitor to
// `/login` would swallow the `?error=…` that explains why their link did not work. The two
// password-reset pages are public for the plainer reason that their whole audience is signed
// out: a reset link never signs anyone in, and the form that asks for one cannot.
const PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  if (pathname.startsWith('/invite/')) {
    return true;
  }
  return false;
}

/**
 * A path shaped like a file rather than a page: Next's own asset routes, and anything with an
 * extension.
 *
 * These skip the session probe — a request for `/favicon.ico` should not cost an API round
 * trip — but they do *not* skip the CSP below, because skipping it is not the same as not
 * needing it: nothing in `public/` matches these names today, so what actually answers them is
 * `app/not-found.tsx`, which is HTML with the same inline hydration scripts as any other page.
 * A 404 that renders without the header would be the one document in the app running with no
 * policy at all.
 */
function isAssetPath(pathname: string): boolean {
  return pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.');
}

/**
 * This runs inside the Next server, not in the visitor's browser, so it needs the *absolute*
 * API address (`getServerApiBaseUrl`), never the possibly-relative one the client bundle uses:
 * `fetch('/api/auth/get-session')` has no origin to resolve against here. See `lib/api-url.ts`.
 */
async function hasSession(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return false;
  }

  try {
    const response = await fetch(`${getServerApiBaseUrl()}/auth/get-session`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (!response.ok) {
      return false;
    }
    const session = (await response.json()) as { user?: unknown } | null;
    return Boolean(session?.user);
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  /**
   * One nonce per request, minted before any branch can return, so there is no route through
   * this function that answers without a policy.
   *
   * `getApiBaseUrl()` and not `getServerApiBaseUrl()`: `connect-src` governs what the
   * *browser* is allowed to dial, and the browser uses the public base. The internal
   * container address `hasSession` above talks to is this server's business, and naming it in
   * a header sent to the browser would leak the private topology for no benefit.
   */
  const nonce = createCspNonce();
  const csp = buildContentSecurityPolicy(getApiBaseUrl(), nonce);

  /**
   * The header goes on the forwarded *request* as well as the response, and the request copy
   * is the load-bearing one: Next reads `Content-Security-Policy` off the incoming request,
   * pulls the `'nonce-…'` value out of it, and stamps that nonce onto every script tag it
   * emits — the RSC hydration payload, the framework bundle, the page chunks. Set it only on
   * the response and the browser gets a policy no script in the document can satisfy.
   */
  function render(): NextResponse {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('content-security-policy', csp);
    requestHeaders.set(CSP_NONCE_HEADER, nonce);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  // A redirect carries no document, so its policy protects nothing on its own; it is set for
  // the reader rather than the browser, so that "which responses carry the CSP" has one
  // answer — every response this file produces — instead of an exception to remember.
  function redirectTo(url: URL): NextResponse {
    const response = NextResponse.redirect(url);
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  if (isAssetPath(pathname)) {
    return render();
  }

  const session = await hasSession(request);

  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = session ? '/dashboard' : '/login';
    return redirectTo(url);
  }

  if (isPublicPath(pathname)) {
    return render();
  }

  if (!session) {
    const url = request.nextUrl.clone();
    // The whole deep link goes *inside* the parameter, query string included: cloned onto
    // `/login` as it stands, the protected route's own parameters would arrive as stray
    // sign-in parameters and be dropped on the way back. `/login` reads this one and only
    // honours a same-origin path (`lib/auth-redirect.ts`).
    const destination = `${pathname}${request.nextUrl.search}`;
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set(NEXT_PARAM, destination);
    return redirectTo(url);
  }

  return render();
}

/**
 * `_next/static` and `_next/image` are the only exclusions, and they are excluded because
 * neither can carry an inline script: one serves the immutable build output, the other an
 * optimised image. Everything else runs through, including paths with an extension — see
 * {@link isAssetPath} for why a request that looks like a file still needs the header.
 *
 * The five constant security headers (`Strict-Transport-Security`, `X-Frame-Options`, and
 * friends) still come from `next.config.ts`'s `headers()`, which has no such exclusions, so
 * the two asset routes skipped here are not left bare.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
