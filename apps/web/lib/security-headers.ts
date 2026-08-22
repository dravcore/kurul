import { isSameOriginApiBaseUrl } from './api-url';

/**
 * `{ key, value }` is the exact shape `next.config.ts`'s `headers()` expects for each entry it
 * returns, so this module hands the config file a ready-to-use array instead of a string map
 * the config would have to reshape. Kept here rather than inline in `next.config.ts` so a
 * vitest suite can import the real source — a copy pasted into a test file would drift the
 * first time someone edited one but not the other.
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * The request header `proxy.ts` writes the per-request nonce into, so a server component can
 * read it back with `headers()`.
 *
 * `x-nonce` is the name Next's own CSP guide uses, and matching it means a reader who arrives
 * from those docs finds what they expect. It is deliberately *not* also a response header:
 * the value is already public in the `Content-Security-Policy` response header, so a second
 * copy would add a name to grep for and nothing else.
 *
 * Next does not read this header — it parses the nonce out of the `Content-Security-Policy`
 * header on the *request* to nonce its own framework and bundle `<script>` tags. This one
 * exists for the inline script `next-themes` writes, which Next has no way to know about.
 */
export const CSP_NONCE_HEADER = 'x-nonce';

/**
 * A fresh nonce for one response.
 *
 * 16 bytes from the platform CSPRNG, base64-encoded. The entropy is the whole point of a
 * nonce, and 128 bits is the figure CSP Level 3 asks for
 * (https://www.w3.org/TR/CSP3/#security-nonces); anything a page render could *derive*
 * (a request id, a timestamp, a hash of the path) would be a nonce an attacker can predict,
 * which is a nonce that defends nothing.
 *
 * `crypto.getRandomValues` + `btoa` rather than Node's `randomBytes`, because this runs in
 * the edge runtime `proxy.ts` is compiled for, where `node:crypto` is not available. `+`, `/`
 * and `=` all belong to CSP's `base64-value` grammar, so the encoded output needs no further
 * escaping inside `'nonce-…'`.
 */
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The `ws(s)` origin Socket.io actually dials, derived from the API's `http(s)` origin.
 *
 * `lib/socket.ts` connects with `transports: ['websocket', 'polling']` against the same
 * `NEXT_PUBLIC_API_URL` the REST client uses. A CSP `connect-src` that only lists the
 * `http(s)` origin still lets `fetch`/XHR and the polling transport through — polling rides
 * ordinary HTTP requests — but the browser blocks the WebSocket upgrade outright, because
 * `ws:`/`wss:` is a distinct scheme from CSP's point of view. Without this, the app would look
 * fully functional (every REST call and every polling-transport socket event succeeds) while
 * silently running degraded on the slower transport, with nothing but a console CSP violation
 * to explain why — the kind of gap that survives a click-through smoke test and only shows up
 * as "realtime feels laggy" days later.
 */
function websocketOrigin(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

/**
 * `connect-src` sources for whichever API topology this build was configured for.
 *
 * The same-origin build (`NEXT_PUBLIC_API_URL=/api`, what the published image ships — see
 * `lib/api-url.ts`) gets `'self'` and nothing else, and that is not a shortcut: this header is
 * static Next config, evaluated once at build time, so there is no request whose `Host` a
 * per-deployment origin could be derived from. It has to be a value that is already correct on
 * every domain, which is exactly what `'self'` is.
 *
 * `'self'` also covers the WebSocket upgrade, which is the part worth stating because the
 * absolute branch below needs an explicit `ws(s)://` source for the same connection. CSP
 * Level 3 defines `'self'` as matching a URL whose host and port match the protected
 * document's and whose scheme is `ws`/`wss` when the document is `http`/`https`
 * (https://www.w3.org/TR/CSP3/#match-url-to-source-expression, step 4.2) — the scheme upgrade
 * that CSP2 lacked, and the reason the older, absolute topology had to name `wss://…`
 * separately. Verified empirically rather than taken from the spec: a production build served
 * behind the reverse proxy under this exact header opened its Socket.io connection on the
 * `websocket` transport (HTTP 101 on `/api/socket.io/?…&transport=websocket`) with no CSP
 * violation reported — see `docs/self-hosting.md`. Had it been wrong, the failure would have
 * been the quiet kind: socket.io would have fallen back to the `polling` transport, which
 * `'self'` allows as ordinary HTTP, and the app would have looked fine while running degraded.
 */
function connectSources(apiBaseUrl: string): string[] {
  if (isSameOriginApiBaseUrl(apiBaseUrl)) {
    return ["'self'"];
  }
  return ["'self'", apiBaseUrl, websocketOrigin(apiBaseUrl)];
}

/**
 * Builds the CSP directive string for one response.
 *
 * Pure, and both arguments are required, so the only way to get a policy is to have already
 * decided what nonce it names — there is no default that silently produces a policy no inline
 * script can satisfy. `proxy.ts` is the sole caller; see {@link createCspNonce}.
 *
 * This is a real browser application — the API's `default-src 'none'` stance
 * (`apps/api/src/common/configure-app.ts`) does not transfer here; a page that loads no
 * script, style or font would not render. Each directive below is scoped to what this app
 * actually does, not to helmet's browser-app defaults, which is why `useDefaults`-equivalent
 * blanket allowances (`data:` images, third-party CDNs, etc.) are deliberately absent — there
 * is nothing in the app that needs them yet, and adding them ahead of a real need only widens
 * the injection surface a future XSS could exploit:
 *
 * - `script-src 'self' 'nonce-…'` — there are exactly two kinds of inline script in a rendered
 *   page, and the nonce is what lets both run without `'unsafe-inline'` letting *everything*
 *   run. Next's App Router streams the RSC payload into the initial HTML as inline
 *   `<script>self.__next_f.push(...)</script>` tags (hydration data, not attacker-controlled
 *   markup), and `next-themes` injects a small inline script in `<head>` to apply the stored
 *   theme class before first paint and avoid a flash of the wrong theme. Next stamps the
 *   nonce onto the first kind by itself — it parses the value out of the
 *   `Content-Security-Policy` header on the *request*, which is why `proxy.ts` sets that
 *   header on the forwarded request and not only on the response. The second kind is nonced
 *   by hand: `app/layout.tsx` reads {@link CSP_NONCE_HEADER} and passes it to `next-themes`.
 *
 *   The value has to be different on every response to mean anything, which is why this
 *   header is minted in `proxy.ts` rather than returned from `next.config.ts`'s `headers()` —
 *   that runs once at build/start, so a "nonce" from there would be one fixed string, weaker
 *   than `'unsafe-inline'` in practice because it looks like a defence. Every route in this
 *   app is already server-rendered on demand (`i18n/request.ts` reads `cookies()` and
 *   `headers()` on every render, so nothing is statically prerendered), which is the
 *   precondition Next's CSP guide names for nonces: a page baked at build time has no request
 *   to take a nonce from, and its inline scripts would be blocked.
 *
 *   **No `'strict-dynamic'`.** Next's guide includes it, and it was tried and then dropped
 *   because it buys nothing here and costs a fallback. `'strict-dynamic'` makes a browser
 *   *ignore* `'self'` and every host source, trusting only what an already-trusted script
 *   inserts — which works, since Next nonces its own `<script src>` bundle tags and the
 *   webpack chunk loader inherits trust from them. But `script-src` here names no host to
 *   begin with, so there is nothing for `'strict-dynamic'` to neutralise; what it would
 *   change is that any bundle tag Next ever forgets to nonce goes from "loads, because it is
 *   same-origin" to "blocked". That is a worse failure mode for a directive whose only job
 *   here is to stop *inline* injection, and `'self'` is not the weak link — a markup
 *   injection cannot add a same-origin script this app does not already serve. Verified both
 *   ways against a production build; the pages load identically with and without it.
 * - `style-src 'self' 'unsafe-inline'` — Radix primitives (via shadcn/ui) position popovers,
 *   dropdowns and tooltips with a computed inline `style` attribute, and `@dnd-kit` writes the
 *   drag transform the same way every animation frame. Nonces do not apply to `style="..."`
 *   attributes at all (only to `<style>`/`<script>` elements), so there is no nonce variant of
 *   this trade-off to make — allowing inline styles is the only way these libraries function
 *   under any CSP.
 * - `connect-src` — every `fetch` goes through `lib/api.ts` to `NEXT_PUBLIC_API_URL`, which
 *   Next inlines at build time (see `.env.example`), and the Socket.io client in
 *   `lib/socket.ts` dials the same base over `ws(s)`. What that expands to depends on which
 *   API topology the build was configured for; see {@link connectSources}.
 * - `img-src 'self' blob:`, `font-src 'self'` — the app loads no remote images (no avatar
 *   upload, no `next/image` remote patterns configured) and self-hosts its three typefaces via
 *   `next/font/google`, which downloads them at build time and serves them from this origin —
 *   so neither directive needs to reach off-origin. `blob:` is the one addition, and it is not
 *   an off-origin allowance: an image attachment is previewed by fetching its bytes through
 *   `lib/api.ts` (which is what `connect-src` already governs) and handing the resulting
 *   `Blob` to `URL.createObjectURL`. `'self'` does not cover a `blob:` URL — the scheme has to
 *   be listed for a source expression to match it — so without this the preview is blocked on
 *   *every* topology, not only the split-domain one. The bytes still have to pass
 *   `connect-src` first, so nothing an attacker could not already fetch becomes displayable;
 *   what `blob:` adds is the ability to render bytes this origin has already received.
 *
 *   The fetch-and-blob route is used rather than pointing `<img src>` straight at the API,
 *   because on a split-domain deployment that URL is off-origin and widening `img-src` to the
 *   API origin would let markup injection render arbitrary API responses as images (ADR 0022).
 * - `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'` — the app never embeds
 *   itself in a frame, never embeds anything else in one, and loads no plugin content
 *   (`<object>`/`<embed>`). `frame-ancestors` is the CSP-level clickjacking defense that backs
 *   up `X-Frame-Options: DENY` below for browsers that honour CSP over the legacy header.
 * - `base-uri 'self'`, `form-action 'self'` — nothing in the app renders a `<base>` tag or
 *   submits a native HTML form cross-origin (auth and mutations go through `fetch` in
 *   `lib/api.ts` and Better Auth's client); locking both to `'self'` closes off a classic
 *   markup-injection pivot — smuggling in a `<base href="https://evil">` or a form that posts
 *   credentials elsewhere — without disabling anything the app uses.
 */
export function buildContentSecurityPolicy(apiBaseUrl: string, nonce: string): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:']],
    ['font-src', ["'self'"]],
    ['connect-src', connectSources(apiBaseUrl)],
    ['frame-ancestors', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/**
 * Browser-standard "powerful feature" APIs this app never calls: no board attaches a camera
 * or microphone stream, asks for the visitor's location, or reads payment/USB hardware.
 * Denying them with `()` (rather than leaving them unlisted, which defaults to "allowed for
 * same-origin") means an XSS or a compromised dependency cannot silently turn one on — the
 * browser refuses the permission prompt itself instead of the app having to be trusted not to
 * ask.
 *
 * `interest-cohort=()` opts out of the FLoC/Topics-API cohort tracking Chrome computes from
 * browsing history by default; it costs nothing here since Kurul does no ad-adjacent
 * tracking, and it is the one entry in this list that protects the *user's* privacy on other
 * sites rather than this app's own attack surface.
 */
const DISABLED_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
  'interest-cohort',
] as const;

function buildPermissionsPolicy(): string {
  return DISABLED_PERMISSIONS.map((feature) => `${feature}=()`).join(', ');
}

/**
 * The *static* security headers `next.config.ts` attaches to every route via `headers()`.
 *
 * Content-Security-Policy is deliberately not among them: it is the one header here whose
 * value differs per response (the nonce), so `proxy.ts` sets it instead. The five below are
 * constants — the same bytes on every response, for every deployment — and `headers()` is the
 * right place for a constant: it covers `_next/static` and every other asset route the proxy's
 * matcher skips, and it costs nothing per request.
 */
export function getSecurityHeaders(): SecurityHeader[] {
  return [
    // Matches the API's HSTS (`configure-app.ts`) for the same reason: browsers ignore
    // Strict-Transport-Security on plain-HTTP responses, so this is inert in local/dev over
    // http and only takes effect once the deployment terminates TLS in front of `web`.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    // Belt-and-braces with `frame-ancestors` above: DENY beats SAMEORIGIN because nothing in
    // this app ever needs to be framed, not even by itself.
    { key: 'X-Frame-Options', value: 'DENY' },
    // Stops a browser from re-sniffing a response's declared Content-Type — the classic vector
    // is a user-uploaded file served as `text/plain` that a browser decides to render as HTML.
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // `strict-origin-when-cross-origin` (Next's own default, made explicit here rather than
    // left implicit) sends the full URL as a referrer to same-origin requests — useful for the
    // app's own analytics-free navigation debugging — but only the origin, no path or query,
    // to a cross-origin destination, and nothing at all on a downgrade to plain HTTP. Task
    // titles and board names never end up in another site's server logs.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: buildPermissionsPolicy() },
  ];
}
