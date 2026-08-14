/**
 * Where the browser suite's stack lives, and why it lives there.
 *
 * The suite boots a *second* copy of the application next to whatever the developer already
 * has running. That is the whole point: `pnpm dev` on 3000/4000 against the `kurultay`
 * database is a working session with real data in it, and a suite that signs up users,
 * accepts invitations and drags cards around must never be pointed at it. Every value below
 * is therefore deliberately off the beaten path, and none of it is configurable through
 * `.env` — a mis-set variable here would be a suite that silently ran against the wrong
 * database, which is exactly the failure this file exists to make impossible.
 *
 * The one thing that *is* inherited is the Postgres/Redis *connection* (host, port,
 * credentials), because those belong to the machine, not to the suite. Only the database
 * name and the Redis logical database are swapped.
 */

import './load-env.mjs';
import { API_PORT, API_URL, e2eDatabaseUrl, WEB_PORT, WEB_URL } from './stack-shared.mjs';

export { API_URL, WEB_URL };

/**
 * Mailpit: SMTP on 1025, HTTP API on 8025 — the ports `docker-compose.dev.yml` publishes and
 * the ones the CI workflow's service container maps, so there is one address and no knob.
 *
 * The suite reads the verification and invitation mails out of it rather than shortcutting to
 * `prisma.user.update({ emailVerified: true })`: the link in the mail body is a real part of
 * the invitation flow, it is built from `WEB_URL`, and a wrong `WEB_URL` produces a mail
 * nobody can act on that no API test notices.
 */
export const MAILPIT_URL = 'http://localhost:8025';

const SMTP_HOST = 'localhost';
const SMTP_PORT = '1025';

/**
 * Redis logical database 8. The API only needs Redis for the Socket.io fan-out adapter and
 * the BullMQ queues; both are namespaced by database index, so an index nobody else uses is
 * enough isolation and needs no separate server.
 */
const E2E_REDIS_DB = '8';

/**
 * The suite's Redis URL: the machine's connection with only the logical database swapped.
 * Empty when `REDIS_URL` is unset, which is a supported configuration — the API logs that the
 * Socket.io Redis adapter was not attached and single-instance realtime works regardless.
 */
function e2eRedisUrl(): string {
  const base = process.env.REDIS_URL;
  if (!base) {
    return '';
  }
  const parsed = new URL(base);
  parsed.pathname = `/${E2E_REDIS_DB}`;
  return parsed.toString();
}

/**
 * Environment for the API process the suite boots.
 *
 * `RATE_LIMIT_ENABLED=false` is not cosmetic: Better Auth caps `/sign-in*` and `/sign-up*` at
 * three requests per ten seconds per IP, and this suite creates several accounts per
 * scenario from one address. With the limiter on, whichever test happened to run fourth
 * would fail with a 429 that has nothing to do with what it is testing. The API's own
 * integration suite disables it for the same reason (`apps/api/test/setup-e2e.ts`).
 *
 * `CLEANUP_ENABLED=false` keeps the nightly retention sweep from starting a BullMQ worker
 * that would outlive the test run and hold the Redis connection open.
 */
export function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {
    DATABASE_URL: e2eDatabaseUrl(),
    API_PORT: String(API_PORT),
    WEB_URL,
    BETTER_AUTH_URL: API_URL,
    // Fixed rather than inherited: the suite's sessions are throwaway, and a secret that
    // changes with the developer's `.env` would make a failure depend on their machine. It is
    // padded past 32 characters only to keep Better Auth's startup warning out of the test
    // output — nothing here is protecting anything.
    BETTER_AUTH_SECRET: 'kurultay-playwright-e2e-secret-not-a-real-secret',
    RATE_LIMIT_ENABLED: 'false',
    CLEANUP_ENABLED: 'false',
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE: 'false',
    MAIL_FROM: 'Kurultay E2E <e2e@kurultay.test>',
    // Sentry stays off: the suite deliberately provokes 4xx responses, and a configured DSN
    // would ship them somewhere.
    SENTRY_DSN: '',
    NODE_ENV: 'production',
  };

  const redisUrl = e2eRedisUrl();
  if (redisUrl) {
    env.REDIS_URL = redisUrl;
  }

  return env;
}

/**
 * Environment for the Next.js server.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at *build* time, so the web build this suite runs against
 * is not interchangeable with a normal `pnpm build`: it hard-codes port 4110 into the client
 * bundle. Both the local runner (`e2e/build-stack.mjs`) and the CI workflow set it for the
 * build, and both overwrite `apps/web/.next` — after a local suite run, rebuild before using
 * `pnpm --filter @kurultay/web start`. This is documented in docs/testing.md rather than
 * worked around with a second `distDir`, because a `distDir` switch would have to live in
 * `apps/web/next.config.ts` and change how the shipped app is configured for the benefit of
 * a test.
 */
export function webEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_API_URL: API_URL,
    PORT: String(WEB_PORT),
    NODE_ENV: 'production',
  };
}
