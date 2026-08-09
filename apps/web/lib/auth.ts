import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { ac as sharedAc, organizationRoles as sharedRoles } from '@kurultay/auth-access';
import { getApiBaseUrl } from './api';

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  // Must match apps/api Better Auth `basePath` (default client path is `/api/auth`).
  basePath: '/auth',
  plugins: [
    organizationClient({
      // Peer better-auth; cast avoids pnpm duplicate-type identity friction.
      ac: sharedAc as never,
      roles: sharedRoles as never,
    }),
  ],
});
