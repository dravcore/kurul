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
 * The one thing that *is* inherited is the Postgres *connection* (host, port, credentials),
 * because that belongs to the machine, not to the suite. Only the database name is swapped.
 * Redis is not inherited at all — see `apiEnv` for why the suite runs without it.
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
 * Environment for the API process the suite boots.
 *
 * `RATE_LIMIT_ENABLED=false` is not cosmetic: Better Auth caps `/sign-in*` and `/sign-up*` at
 * three requests per ten seconds per IP, and this suite creates several accounts per
 * scenario from one address. With the limiter on, whichever test happened to run fourth
 * would fail with a 429 that has nothing to do with what it is testing. The API's own
 * integration suite disables it for the same reason (`apps/api/test/setup-e2e.ts`).
 *
 * `CLEANUP_ENABLED=false` keeps the nightly retention sweep from starting a BullMQ worker
 * that would outlive the test run and hold a connection open.
 *
 * **`REDIS_URL` is deliberately blanked**, and this is the one decision here that is not
 * obvious. Blanked rather than omitted: Playwright spawns a `webServer` with
 * `{ ...process.env, ...env }`, so leaving the key out would hand the API whatever the
 * developer's `.env` put in `process.env` — the exact value this is refusing. `envString`
 * reads an empty string as unset, the same way `SENTRY_DSN` is switched off below.
 *
 * The intent was a logical database index nobody else uses — `redis://…/8` — on the theory
 * that both Redis consumers (the Socket.io fan-out adapter and the BullMQ queues) are
 * namespaced by index. The index does not survive: `apps/api/src/common/redis-url.ts`
 * `parseRedisUrl` returns only `{ host, port, password }` and drops the URL's pathname, and
 * every ioredis/BullMQ construction in `apps/api` goes through it. Measured with the compiled
 * API booted on `redis://localhost:6379/8`: `CLIENT LIST` reported six connections, all
 * `db=0`, `dbsize` on 8 was zero, and the suite's own `bull:due-soon:repeat:due-soon-scan`
 * scheduler key was sitting in database 0 next to the developer's. That is issue #190, it is
 * an API defect rather than a test-harness one, and it is not fixed from here.
 *
 * So an index is not available, and a key prefix is not either: BullMQ's `prefix` and the
 * adapter's channel names are chosen in `apps/api` source, which this suite does not touch.
 * What is left is the fact that the API supports running with no Redis at all — `HealthService`
 * grades it `skipped` rather than `down`, the gateway logs that the adapter was not attached,
 * and the due-soon worker declines to start — so that is what the suite does. It is the only
 * option here that is actually isolated instead of merely documented as such.
 *
 * Nothing under test loses coverage by it. The stack is a single API process, so the Redis
 * adapter would only be fanning messages out to the process that published them; the realtime
 * scenario exercises the same gateway either way. Keeping Redis on would have cost something
 * real: two API instances sharing database 0 share the `due-soon` *queue*, so a `pnpm dev`
 * server and this suite would take turns consuming one another's scheduled scans and running
 * them against the wrong database.
 *
 * When #190 lands, `REDIS_URL: redis://…/8` becomes a genuine boundary and is worth
 * reinstating — attaching the adapter and registering the queue would then be part of what a
 * boot failure is caught by.
 */
export function apiEnv(): Record<string, string> {
  return {
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
    // See the long note above: an inherited Redis is a shared Redis, because `parseRedisUrl`
    // drops the database index (#190). Blanking it is what makes the suite's isolation real.
    REDIS_URL: '',
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE: 'false',
    MAIL_FROM: 'Kurultay E2E <e2e@kurultay.test>',
    // Sentry stays off: the suite deliberately provokes 4xx responses, and a configured DSN
    // would ship them somewhere.
    SENTRY_DSN: '',
    NODE_ENV: 'production',
  };
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
