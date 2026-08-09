import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/register']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  if (pathname.startsWith('/invite/')) {
    return true;
  }
  return false;
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

async function hasSession(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return false;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/get-session`, {
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

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const session = await hasSession(request);

  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = session ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
