import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { getApiBaseUrl } from './api';
import { ac, organizationRoles } from './permissions';

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  // Must match apps/api Better Auth `basePath` (default client path is `/api/auth`).
  basePath: '/auth',
  plugins: [
    organizationClient({
      ac,
      roles: organizationRoles,
    }),
  ],
});
