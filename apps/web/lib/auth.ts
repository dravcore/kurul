import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import type { AccessControl } from 'better-auth/plugins/access';
import { ac as sharedAc, organizationRoles as sharedRoles } from '@kurul/auth-access';
import { getApiBaseUrl } from './api';
import { getServerApiBaseUrl, resolveApiOrigin } from './api-url';

/**
 * The origin Better Auth's client dials — an origin and never a path, for the reasons in
 * {@link resolveApiOrigin}.
 *
 * Resolved differently depending on where this module is being evaluated. In the browser it is
 * the page's own origin, which keeps the request same-origin and keeps the deployment's
 * hostname out of the build — the whole point of the same-origin topology. During the
 * server-side render of a client component there is no `window`, and the value is never
 * dialled from there anyway (every Better Auth call in this app originates from an event
 * handler or an effect); it only has to parse. The server-side API address is used for that
 * rather than a placeholder, because it is the address that would actually work if the "never
 * dialled" half of this ever stopped being true.
 */
function authClientOrigin(): string {
  return typeof window === 'undefined'
    ? resolveApiOrigin(getServerApiBaseUrl(), '')
    : resolveApiOrigin(getApiBaseUrl(), window.location.origin);
}

export const authClient = createAuthClient({
  baseURL: authClientOrigin(),
  // Must match apps/api Better Auth `basePath` (default client path is `/api/auth`). Note this
  // is *not* behind the proxy's `/api` prefix that `lib/api.ts` uses: Better Auth needs one
  // mount path that is identical on the server, in the browser and in the links it mails out,
  // so the reverse proxy forwards `/auth/*` unchanged — see `docker/Caddyfile`.
  basePath: '/auth',
  plugins: [
    organizationClient({
      // `createAccessControl` returns an access control narrowed to our own statements, which
      // is not assignable to the plugin's `AccessControl` parameter (its `newRole` is declared
      // over the open `Statements` type, so the two are contravariant). `roles` is passed
      // as-is on purpose: the plugin infers the role names from it, which is what keeps
      // OWNER / ADMIN / MEMBER / GUEST checked at the call sites.
      ac: sharedAc as unknown as AccessControl,
      roles: sharedRoles,
    }),
  ],
});
