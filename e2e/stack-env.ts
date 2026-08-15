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
import {
  API_PORT,
  API_URL,
  E2E_STORAGE_PATH,
  e2eDatabaseUrl,
  WEB_PORT,
  WEB_URL,
} from './stack-shared.mjs';

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
 * namespaced by index. Half of that theory was wrong and the other half was broken.
 *
 * Broken: `parseRedisUrl` dropped the URL's pathname, and every ioredis/BullMQ construction in
 * `apps/api` goes through it, so an API booted on `redis://localhost:6379/8` put all six of its
 * connections and its `bull:due-soon:repeat:due-soon-scan` scheduler key on database 0, beside
 * the developer's. That was #190 and it is fixed: the index now reaches every consumer, asserted
 * against a live server in `apps/api/test/redis-database-index.e2e-spec.ts`.
 *
 * Wrong: an index namespaces a *keyspace*, not a channel. Redis delivers a published message to
 * every subscriber of that channel whatever database each connection selected (measured, and
 * asserted in the same spec), so the Socket.io adapter — which is pub/sub and nothing else —
 * would still be shared with a `pnpm dev` API on the same server no matter which index this
 * suite picked. A key prefix is not available either: BullMQ's `prefix` and the adapter's
 * channel names are chosen in `apps/api` source, which this suite does not touch.
 *
 * So `redis://…/8` would now genuinely separate the *queue* — the part that actually bit, since
 * two API instances sharing the `due-soon` queue take turns consuming one another's scheduled
 * scans against the wrong database — while leaving the fan-out channel shared. That is a real
 * improvement over blanking and it is not free: it would boot the adapter and the worker inside
 * the suite, which is a behaviour change for every scenario and wants its own verification
 * rather than a comment saying it should be fine. Until someone does that, this stays blank,
 * which is the option that is isolated rather than merely documented as such: the API supports
 * running with no Redis at all — `HealthService` grades it `skipped` rather than `down`, the
 * gateway logs that the adapter was not attached, and the due-soon worker declines to start.
 *
 * Nothing under test loses coverage by it. The stack is a single API process, so the Redis
 * adapter would only be fanning messages out to the process that published them; the realtime
 * scenario exercises the same gateway either way.
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
    // Attachments on. Stated here rather than inherited for the same reason as everything else
    // in this object: `webServer` spawns with `{ ...process.env, ...env }`, so a developer whose
    // `.env` happens to carry a `STORAGE_PATH` would otherwise have the suite writing into their
    // real attachment store — and one whose `.env` does not would get a scenario that fails on a
    // missing file input rather than on anything about the product. See `E2E_STORAGE_PATH`.
    //
    // `ATTACHMENT_MAX_BYTES` is deliberately *not* pinned: the browser scenario never approaches
    // it, and the upload measurement is only honest if it runs against the shipped default.
    STORAGE_PATH: E2E_STORAGE_PATH,
    // See the long note above: an index would now separate the queues (#190 is fixed) but not
    // the Socket.io channel, and switching this suite onto a Redis is its own change. Blanking
    // it is still what makes the isolation real.
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
