import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv, envString } from '../common/env';
import { ac, organizationRoles } from './permissions';

loadRootEnv();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error('BETTER_AUTH_SECRET is required');
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Close the Better Auth Prisma pool (tests / graceful shutdown). */
export async function disconnectAuthDatabase(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}

const betterAuthUrl = envString('BETTER_AUTH_URL', 'http://localhost:4000');
const webUrl = envString('WEB_URL', 'http://localhost:3000');

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
      ac,
      roles: organizationRoles,
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
