/**
 * Where the API is, resolved separately for the browser and for this app's own Node process.
 *
 * The two answers are different on purpose, and that split is the whole point of this module.
 *
 * Next.js inlines every `NEXT_PUBLIC_*` expression into the compiled output at *build* time,
 * so `NEXT_PUBLIC_API_URL` is a constant baked into a published image — it cannot be handed to
 * a container at start the way the API's `DATABASE_URL` can. As long as that constant was an
 * absolute origin (`https://api.example.com`), every deployment needed its own web build, and
 * "pull the image, set the environment" was architecturally impossible (audit finding PM-02).
 *
 * The fix is to make the baked constant *deployment-independent* rather than to un-bake it: a
 * same-origin path (`/api`) is correct on every domain, so one image serves them all. That
 * only works because a reverse proxy in front of the stack routes `/api/*` to the API and
 * everything else to this app — see `docker/Caddyfile` and `docs/self-hosting.md`. It is also
 * what makes the API's cookies same-site rather than cross-site, which is the reason the
 * proxy option was chosen over patching the placeholder out of `.next` in an entrypoint: a
 * `sed` over built JavaScript has to find every copy (client chunks, the server bundle *and*
 * the pre-rendered CSP in `routes-manifest.json`), breaks source maps, and needs a writable
 * image at runtime — three failure modes that all surface as "works on my machine".
 *
 * Server-side code cannot use that same value: `fetch('/api/me')` has no origin to resolve
 * against inside Node, so `middleware.ts` and `i18n/user-locale.ts` need an absolute address.
 * `INTERNAL_API_URL` supplies it, and because it is *not* a `NEXT_PUBLIC_*` variable it is a
 * genuine runtime lookup — a container-start value, not a build constant. It also points at
 * the API directly over the container network (`http://api:4000`), so a server render never
 * makes a round trip out through the proxy and back, and does not depend on the public
 * hostname resolving from inside the container.
 *
 * An absolute `NEXT_PUBLIC_API_URL` still works exactly as it did before, for a deployment
 * that genuinely wants the API on its own domain — it just keeps the old constraint that such
 * a build is deployment-specific.
 */

/**
 * The API address assumed when nothing is configured: the port `apps/api` listens on in the
 * dev loop (`pnpm dev`, docs/development.md#run-modes), where the two apps really are separate
 * origins and there is no proxy in front of either.
 */
export const DEV_API_BASE_URL = 'http://localhost:4000';

/**
 * A trailing slash on the configured value would produce `//boards` once a path is appended,
 * which a strict router answers with 404 rather than treating as `/boards`. Trimming here
 * rather than at each call site also makes `/` a usable value — it means "the API is at the
 * root of this origin" and normalises to the empty prefix.
 */
function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Whether this base is a path on the app's own origin rather than a separate one.
 *
 * The empty string is included because it is what `/` normalises to above. Callers branch on
 * this instead of re-testing for a leading slash: a same-origin base needs a different
 * Socket.io call shape, a different CSP `connect-src`, and cannot be handed to `new URL()`.
 */
export function isSameOriginApiBaseUrl(base: string): boolean {
  return base === '' || base.startsWith('/');
}

/**
 * The base the *browser* prefixes onto every request — possibly a path, possibly an origin.
 *
 * Blank counts as unset: an operator who leaves `NEXT_PUBLIC_API_URL=` in `.env` gets the dev
 * default rather than a base of `''`, which would silently retarget every call at the web
 * app's own origin and answer each one with this app's 404 page instead of an API error.
 */
export function resolveApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimTrailingSlash(trimmed) : DEV_API_BASE_URL;
}

/**
 * Scheme, host and port of the API — with any path the base carries deliberately dropped.
 *
 * This exists for Better Auth's client, the one caller that can take neither the relative base
 * nor a based-with-path one, for two separate reasons that both turned up by running the app
 * rather than by reading the docs:
 *
 * 1. `createAuthClient` runs `new URL()` over `baseURL` in its constructor and throws
 *    `BetterAuthError: Invalid base URL: /api` on a relative value. The client is built at
 *    module scope, so that throw is not scoped to a request — it blanks every page that
 *    imports it.
 * 2. When `baseURL` *does* carry a path, Better Auth (`utils/url.mjs`, `withPath`) treats that
 *    path as the mount point and ignores `basePath` rather than appending to it — on both
 *    sides. Handing the client `…:8100/api` with `basePath: '/auth'` produced requests to
 *    `/api/sign-up/email`, the `/auth` segment silently gone, which the API answered with a
 *    404 the UI reported as a generic "could not create your account".
 *
 * That second rule is also why Better Auth is the one part of the API that is *not* served
 * under the proxy's `/api` prefix: its mount path has to be the same string on the server, in
 * the browser, and inside the verification links it emails out, so it stays at `/auth` on the
 * origin's root and the reverse proxy forwards that path unchanged (`docker/Caddyfile`).
 *
 * `pageOrigin` is a parameter rather than read from `window` here to keep this pure and
 * testable; call sites pass `window.location.origin`.
 */
export function resolveApiOrigin(base: string, pageOrigin: string): string {
  return isSameOriginApiBaseUrl(base) ? pageOrigin : new URL(base).origin;
}

/** The two variables {@link resolveServerApiBaseUrl} consults, in precedence order. */
export interface ServerApiUrlEnv {
  /** Runtime-only, absolute; the container-network address of the API. */
  internalApiUrl: string | undefined;
  /** Build-time constant; only usable server-side when it is absolute. */
  publicApiUrl: string | undefined;
}

/**
 * The absolute base this app's own Node process uses to call the API.
 *
 * `INTERNAL_API_URL` wins whenever it is set, including over an absolute
 * `NEXT_PUBLIC_API_URL`: the browser's route to the API and the server's are allowed to differ
 * (public hostname versus container network), and when they do, the internal one is the only
 * address that resolves from inside the container.
 *
 * Falling back to the dev default rather than throwing on a same-origin public base is
 * deliberate. The one deployment shape that reaches that branch is a container built for the
 * proxy topology but started without `INTERNAL_API_URL` — a broken configuration either way —
 * and the callers here (`middleware.ts`'s session probe, the locale lookup) are written to
 * degrade rather than throw, so raising would only convert a failed session check into an
 * unhandled rejection on every request. The dev default keeps `pnpm build && pnpm start`
 * working with no extra variable, which is the other, much more common way to hit it.
 */
export function resolveServerApiBaseUrl(env: ServerApiUrlEnv): string {
  const internal = env.internalApiUrl?.trim();
  if (internal) {
    return trimTrailingSlash(internal);
  }
  const browserBase = resolveApiBaseUrl(env.publicApiUrl);
  return isSameOriginApiBaseUrl(browserBase) ? DEV_API_BASE_URL : browserBase;
}

/**
 * {@link resolveServerApiBaseUrl} bound to the process environment.
 *
 * The two variables are read as separate member expressions rather than by handing the whole
 * `process.env` over, and that is load-bearing: Next.js substitutes `process.env.NEXT_PUBLIC_*`
 * only when it appears literally, so spreading the object would leave the public value unset
 * in the client-side compilation while leaving `INTERNAL_API_URL` — which must stay a runtime
 * lookup — exposed to being inlined if it happened to be set during the build.
 */
export function getServerApiBaseUrl(): string {
  return resolveServerApiBaseUrl({
    internalApiUrl: process.env.INTERNAL_API_URL,
    publicApiUrl: process.env.NEXT_PUBLIC_API_URL,
  });
}
