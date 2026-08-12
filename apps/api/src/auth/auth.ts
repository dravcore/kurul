import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv, envString } from '../common/env';
import { buildVerificationEmail } from '../mail/mail-templates';
import { sendMail } from '../mail/send-mail';
import { createSharedPrismaAdapter, registerPoolConsumer } from '../prisma/database';
import { organizationOptions } from './organization-options';
import { resolveVerificationUrl, webAppUrl } from './web-urls';

loadRootEnv();

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error('BETTER_AUTH_SECRET is required');
}

const prisma = new PrismaClient({ adapter: createSharedPrismaAdapter() });

// Better Auth's client borrows from the same pg pool as PrismaService. Hand its disconnect to
// the pool's owner (`prisma/database.ts`) instead of tearing it down from AuthModule: Nest
// does not order `onModuleDestroy` hooks, so a self-managed disconnect could land after the
// pool had already been ended. `closeSharedDatabase` now drains this client first, always.
registerPoolConsumer(() => prisma.$disconnect());

const betterAuthUrl = envString('BETTER_AUTH_URL', 'http://localhost:4000');
const webUrl = webAppUrl();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: authSecret,
  baseURL: betterAuthUrl,
  basePath: '/auth',
  trustedOrigins: [webUrl],
  session: {
    // Avoids a database round trip on every authenticated request; the signed cookie
    // is re-validated against the DB once it expires.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
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
    // Product decision: an unverified address can sign up and sign in normally. Verification
    // gates exactly one thing — accepting a workspace invitation, see `organization-options.ts`
    // — so existing accounts are never locked out by this feature landing.
    requireEmailVerification: false,
  },
  emailVerification: {
    // `sendOnSignUp` defaults to following `requireEmailVerification`, which is `false` above
    // and would mean "never offer anyone a verification link". Every new account gets one:
    // verification is optional for signing in but mandatory before joining a workspace, so a
    // user must always have a way to reach the verified state.
    sendOnSignUp: true,
    // The session cookie caches the user for 5 minutes (`session.cookieCache`), so a user who
    // has just verified would keep presenting `emailVerified: false` — and keep being refused
    // by accept-invitation — until that cache expired. Better Auth rewrites the session cookie
    // here, which fixes the staleness, and signs the user in when they opened the link in a
    // browser that had no session.
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendMail(
        buildVerificationEmail({
          to: user.email,
          name: user.name,
          // Better Auth's link would send the user back to the API origin after verifying.
          verificationUrl: resolveVerificationUrl(url),
        }),
      );
    },
  },
  plugins: [organization(organizationOptions)],
});

export type AuthSession = typeof auth.$Infer.Session;
