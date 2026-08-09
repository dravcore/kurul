import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv, envString } from '../common/env';
import { createSharedPrismaAdapter } from '../prisma/database';
import { ac as sharedAc, organizationRoles as sharedRoles } from '@kurultay/auth-access';

loadRootEnv();

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error('BETTER_AUTH_SECRET is required');
}

const prisma = new PrismaClient({ adapter: createSharedPrismaAdapter() });

/** Close the Better Auth Prisma client (shared pool is ended by PrismaService). */
export async function disconnectAuthDatabase(): Promise<void> {
  await prisma.$disconnect();
}

const betterAuthUrl = envString('BETTER_AUTH_URL', 'http://localhost:4000');
const webUrl = envString('WEB_URL', 'http://localhost:3000');

// `@kurultay/auth-access` peers better-auth; cast avoids pnpm duplicate-type identity friction.
const ac = sharedAc as typeof sharedAc;
const organizationRoles = sharedRoles as typeof sharedRoles;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: authSecret,
  baseURL: betterAuthUrl,
  basePath: '/auth',
  trustedOrigins: [webUrl],
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
    // Cross-origin SPA (web :3000 → api :4000) needs SameSite=None in production HTTPS;
    // locally Better Auth defaults work with credentialed fetch on different ports.
    crossSubDomainCookies: {
      enabled: false,
    },
  },
  user: {
    modelName: 'user',
    fields: {
      image: 'avatarUrl',
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    organization({
      ac: ac as never,
      roles: organizationRoles as never,
      creatorRole: 'OWNER',
      requireEmailVerificationOnInvitation: false,
      async sendInvitationEmail() {
        // Email delivery is deferred beyond MVP; accept URL is returned by the API.
      },
      schema: {
        organization: {
          modelName: 'workspace',
        },
        member: {
          modelName: 'workspaceMember',
          fields: {
            organizationId: 'workspaceId',
          },
        },
        invitation: {
          modelName: 'workspaceInvitation',
          fields: {
            organizationId: 'workspaceId',
          },
        },
      },
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
