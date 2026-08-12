import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import type { AccessControl } from 'better-auth/plugins/access';
import { ac as sharedAc, organizationRoles as sharedRoles } from '@kurultay/auth-access';
import { getApiBaseUrl } from './api';

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  // Must match apps/api Better Auth `basePath` (default client path is `/api/auth`).
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
